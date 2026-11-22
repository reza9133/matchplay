import { Link } from "react-router-dom";
import { Button, Empty } from "../components/UI.jsx";
import { useTitle } from "../lib/hooks.js";

export default function NotFound() {
  useTitle("Not found");
  return (
    <div style={{ padding: "60px 0" }}>
      <Empty title="This page is out of bounds">The page you were looking for does not exist.</Empty>
      <p style={{ textAlign: "center" }}><Button as={Link} to="/">Back to the arena</Button></p>
    </div>
  );
}
