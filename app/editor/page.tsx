import { pageMetadata } from "../site";
import Workbench from "../workbench";
import "./studio.css";
import "./workbench.css";

export const metadata = pageMetadata("Pixel Art Editor", "Draw pixel art with layers and reference images, animate sprites, and build tilemaps in PixelWall. Free drawing, individual PNG exports, and portable projects.", "/editor");

export default function EditorPage() {
  return <Workbench />;
}
