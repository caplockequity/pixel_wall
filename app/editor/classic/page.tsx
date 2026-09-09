import {pageMetadata} from "../../site";
export const metadata=pageMetadata("Pixel Art Editor","Classic PixelWall editor","/editor/classic");
import Studio from "../../studio";
import "../studio.css";
export default function ClassicEditorPage() { return <Studio />; }
