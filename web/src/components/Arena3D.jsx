// A real-time 3D view of a round: entries are spheres on a ring, every pair of entries is a match (an edge), the prize
// coin spins in the middle. Drag to rotate. Built with three.js, loaded lazily.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const PALETTE = [0x110fff, 0xff7a1a, 0x7b3ff2, 0x00b86b, 0xe83e8c, 0x0aa5d8, 0xf5a100, 0x4b5563];
const EDGE = { pending: 0xc3c7e6, a: 0x110fff, b: 0x110fff, tie: 0x8b5cf6, none: 0xffb3b3 };

function labelSprite(text, sub) {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 112;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(255,255,255,.96)";
  g.strokeStyle = "rgba(17,15,255,.25)";
  g.lineWidth = 3;
  const r = 28;
  g.beginPath();
  g.roundRect(6, 6, 308, 100, r);
  g.fill();
  g.stroke();
  g.fillStyle = "#0a0a1f";
  g.font = "700 38px 'Space Grotesk', system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const t = text.length > 14 ? text.slice(0, 13) + "…" : text;
  g.fillText(t, 160, sub ? 44 : 56);
  if (sub) {
    g.fillStyle = "#5a5f7a";
    g.font = "600 26px 'JetBrains Mono', monospace";
    g.fillText(sub, 160, 80);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false });
  const s = new THREE.Sprite(m);
  s.scale.set(1.9, 0.665, 1);
  s.renderOrder = 10;
  return s;
}

function coinTexture(onLoad) {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  const draw = (img) => {
    const grad = g.createRadialGradient(190, 170, 20, 256, 256, 270);
    grad.addColorStop(0, "#ffe2ad");
    grad.addColorStop(0.5, "#ffa83a");
    grad.addColorStop(1, "#e2650a");
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = "rgba(255,255,255,.75)";
    g.lineWidth = 10;
    g.beginPath();
    g.arc(256, 256, 232, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "rgba(120,50,0,.35)";
    g.lineWidth = 4;
    g.beginPath();
    g.arc(256, 256, 214, 0, Math.PI * 2);
    g.stroke();
    if (img) {
      g.save();
      g.globalAlpha = 0.95;
      g.drawImage(img, 106, 106, 300, 300);
      g.restore();
    }
  };
  draw(null);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const img = new Image();
  img.onload = () => {
    draw(img);
    tex.needsUpdate = true;
    onLoad?.();
  };
  img.src = "./brand/gen-token.svg";
  return tex;
}

export default function Arena3D({ nodes, edges, active = -1, height = 440, spin = true }) {
  const host = useRef(null);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify([nodes, edges, active]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "pan-y";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 3.4, 9.2);
    camera.lookAt(0, 0, 0);
    const root = new THREE.Group();
    root.rotation.x = 0.32;
    scene.add(root);

    scene.add(new THREE.AmbientLight(0xffffff, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(4, 7, 6);
    scene.add(sun);
    const blue = new THREE.PointLight(0x4b3bff, 90, 24, 2);
    blue.position.set(-5, 2, 3);
    scene.add(blue);
    const orange = new THREE.PointLight(0xff7a1a, 70, 24, 2);
    orange.position.set(5, -1, -2);
    scene.add(orange);

    const disposables = [];
    const track = (o) => (disposables.push(o), o);

    // prize coin
    const coinTex = track(coinTexture());
    const side = track(new THREE.MeshStandardMaterial({ color: 0xffa83a, metalness: 0.85, roughness: 0.28 }));
    const face = track(new THREE.MeshStandardMaterial({ map: coinTex, metalness: 0.55, roughness: 0.32 }));
    const coin = new THREE.Mesh(track(new THREE.CylinderGeometry(1.05, 1.05, 0.2, 80)), [side, face, face]);
    coin.rotation.x = Math.PI / 2;
    const coinHolder = new THREE.Group();
    coinHolder.add(coin);
    root.add(coinHolder);
    const halo = new THREE.Mesh(
      track(new THREE.TorusGeometry(1.45, 0.025, 12, 100)),
      track(new THREE.MeshBasicMaterial({ color: 0xff9a2e, transparent: true, opacity: 0.55 })),
    );
    halo.rotation.x = Math.PI / 2;
    root.add(halo);

    // entries
    const n = nodes.length;
    const R = 3.3;
    const pos = nodes.map((_, i) => {
      const a = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
      return new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R);
    });
    const orbs = nodes.map((nd, i) => {
      const color = nd.flagged ? 0xff2b2b : PALETTE[i % PALETTE.length];
      const m = track(new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.32, emissive: color, emissiveIntensity: nd.flagged ? 0.35 : 0.12 }));
      const mesh = new THREE.Mesh(track(new THREE.SphereGeometry(0.42, 40, 28)), m);
      mesh.position.copy(pos[i]);
      root.add(mesh);
      if (nd.rank === 1) {
        const ring = new THREE.Mesh(track(new THREE.TorusGeometry(0.66, 0.045, 12, 60)), track(new THREE.MeshStandardMaterial({ color: 0xffc247, metalness: 0.9, roughness: 0.2, emissive: 0xffa000, emissiveIntensity: 0.4 })));
        ring.position.copy(pos[i]);
        ring.rotation.x = Math.PI / 2.4;
        root.add(ring);
        mesh.userData.ring = ring;
      }
      const sp = labelSprite(nd.label, nd.sub);
      sp.position.set(pos[i].x, 1.05, pos[i].z);
      root.add(sp);
      track(sp.material.map);
      track(sp.material);
      return mesh;
    });

    // matches
    const up = new THREE.Vector3(0, 1, 0);
    const pulses = [];
    edges.forEach((e, k) => {
      const A = pos[e.a], B = pos[e.b];
      if (!A || !B) return;
      const dir = new THREE.Vector3().subVectors(B, A);
      const len = dir.length();
      const color = EDGE[e.state] ?? EDGE.pending;
      const thick = e.state === "pending" ? 0.018 : 0.034;
      const cyl = new THREE.Mesh(track(new THREE.CylinderGeometry(thick, thick, len, 8)), track(new THREE.MeshStandardMaterial({ color, roughness: 0.5, transparent: true, opacity: e.state === "pending" ? 0.75 : 1 })));
      cyl.position.copy(A).addScaledVector(dir, 0.5);
      cyl.quaternion.setFromUnitVectors(up, dir.clone().normalize());
      root.add(cyl);
      if (e.state === "a" || e.state === "b") {
        const toward = e.state === "a" ? A : B;
        const from = e.state === "a" ? B : A;
        const d = new THREE.Vector3().subVectors(toward, from).normalize();
        const cone = new THREE.Mesh(track(new THREE.ConeGeometry(0.11, 0.3, 14)), track(new THREE.MeshStandardMaterial({ color: 0x110fff, roughness: 0.4 })));
        cone.position.copy(toward).addScaledVector(d, -0.78);
        cone.quaternion.setFromUnitVectors(up, d);
        root.add(cone);
      }
      if (k === active) {
        const p = new THREE.Mesh(track(new THREE.SphereGeometry(0.13, 18, 14)), track(new THREE.MeshBasicMaterial({ color: 0xff7a1a })));
        root.add(p);
        pulses.push({ mesh: p, A, B });
        cyl.material.color.set(0xff7a1a);
        cyl.scale.x = cyl.scale.z = 2.2;
      }
    });

    // sizing
    const resize = () => {
      const w = el.clientWidth || 600;
      renderer.setSize(w, height, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = height + "px";
      camera.aspect = w / height;
      camera.position.z = w < 520 ? 12.4 : 9.2;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // drag to rotate
    let dragging = false, lx = 0, ly = 0, vy = 0;
    const down = (e) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      renderer.domElement.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      root.rotation.y += dx * 0.008;
      vy = dx * 0.008;
      root.rotation.x = Math.max(0.0, Math.min(0.95, root.rotation.x + dy * 0.005));
    };
    const up2 = () => (dragging = false);
    renderer.domElement.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up2);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = true;
    const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting), { threshold: 0.01 });
    io.observe(el);
    let raf, t0 = performance.now();
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      const s = (t - t0) / 1000;
      if (!dragging) {
        vy *= 0.94;
        root.rotation.y += reduce || !spin ? vy : 0.0042 + vy;
      }
      coin.rotation.z = reduce ? 0 : s * 1.1;
      coinHolder.position.y = reduce ? 0 : Math.sin(s * 1.6) * 0.12;
      halo.rotation.z = s * 0.4;
      orbs.forEach((o, i) => {
        if (reduce) return;
        o.position.y = Math.sin(s * 1.4 + i) * 0.14;
        if (o.userData.ring) {
          o.userData.ring.position.y = o.position.y;
          o.userData.ring.rotation.z = s * 1.2;
        }
      });
      pulses.forEach((p) => {
        const f = (s * 0.55) % 1;
        p.mesh.position.lerpVectors(p.A, p.B, f);
      });
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      renderer.domElement.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up2);
      disposables.forEach((d) => d?.dispose?.());
      scene.traverse((o) => o.geometry?.dispose?.());
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, height, spin]);

  if (failed) return <div className="arena-fallback">3D view needs WebGL, which this browser does not offer.</div>;
  return <div className="arena3d" ref={host} style={{ height }} />;
}
