import './style.css'
import { setupUploader } from "./uploader.ts";

setupUploader(document.querySelector<HTMLDivElement>('#uploader')!);
