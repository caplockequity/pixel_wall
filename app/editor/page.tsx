import { pageMetadata } from "../site";
import Studio from "../studio";
import "./studio.css";

export const metadata = pageMetadata("Pixel Art Editor", "Draw pixel art with layers and reference images, animate sprites, and build tilemaps in PixelWall. Free drawing, individual PNG exports, and portable projects.", "/editor");

export default function EditorPage() {
  return <Studio />;
}
