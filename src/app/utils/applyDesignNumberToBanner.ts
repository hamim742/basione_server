import fs from "fs";
import path from "path";
import axios from "axios";
import sharp from "sharp";
import { AppError } from "../error/AppError";
import { uploadBufferToS3 } from "./uploadAws";

const getFontPath = (): string => {
  const pathsToTry = [
    // 1. Relative to __dirname in development (src/app/utils/ -> src/app/assets/fonts/)
    path.join(__dirname, "..", "assets", "fonts", "Roboto-Bold.ttf"),
    
    // 2. Relative to __dirname in production compiled (dist/app/utils/ -> src/app/assets/fonts/)
    path.join(__dirname, "..", "..", "..", "src", "app", "assets", "fonts", "Roboto-Bold.ttf"),
    
    // 3. Relative to process.cwd() in src
    path.join(process.cwd(), "src", "app", "assets", "fonts", "Roboto-Bold.ttf"),
    
    // 4. Relative to process.cwd() in dist
    path.join(process.cwd(), "dist", "app", "assets", "fonts", "Roboto-Bold.ttf"),

    // 5. In case they copied assets directly to root app/assets/fonts
    path.join(process.cwd(), "app", "assets", "fonts", "Roboto-Bold.ttf"),
  ];

  // console.log(`[Font Discovery] process.cwd(): ${process.cwd()}`);
  // console.log(`[Font Discovery] __dirname: ${__dirname}`);

  for (const p of pathsToTry) {
    const exists = fs.existsSync(p);
    // console.log(`[Font Discovery] Checking path: ${p} - Exists: ${exists}`);
    if (exists) {
      // console.log(`[Font Discovery] Successfully selected font path: ${p}`);
      return p.replace(/\\/g, "/");
    }
  }

  // Fallback to the default path if none exists
  const fallback = path.join(process.cwd(), "src", "app", "assets", "fonts", "Roboto-Bold.ttf").replace(/\\/g, "/");
  console.warn(`[Font Discovery] WARNING: Font not found in any standard location. Falling back to: ${fallback}`);
  return fallback;
};

const fontPath = getFontPath();

const escapeSvgText = (value: string) => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const getWatermarkSvg = ({
  text,
  width,
  height,
  widthCm,
  heightCm,
}: {
  text: string;
  width: number;
  height: number;
  widthCm?: number;
  heightCm?: number;
}) => {
  // Determine pixel density (pxPerCm)
  let pxPerCm = 0;
  if (widthCm && widthCm > 0) {
    pxPerCm = width / widthCm;
  } else if (heightCm && heightCm > 0) {
    pxPerCm = height / heightCm;
  } else {
    // Fallback: assume standard 120cm banner width
    pxPerCm = width / 120;
  }

  // Client requirement:
  // 1. "approximately 2 cm wide"
  // 2. "same size and position in every design"
  // 3. "small and subtle in every design"
  const targetWidthCm = 2.0; // 2 cm wide
  const targetHeightCm = 0.55; // 5.5 mm height

  const boxWidth = Math.max(24, Math.round(targetWidthCm * pxPerCm));
  const boxHeight = Math.max(10, Math.round(targetHeightCm * pxPerCm));
  const radius = Math.round(boxHeight * 0.2);

  // Proportional font calculation to fit inside the 2 cm box comfortably
  const textLength = Math.max(1, text.length);
  const maxFontFromWidth = (boxWidth * 0.86) / (textLength * 0.62);
  const maxFontFromHeight = boxHeight * 0.68;
  const fontSize = Math.max(8, Math.floor(Math.min(maxFontFromWidth, maxFontFromHeight)));
  const textY = Math.round(boxHeight / 2 + fontSize * 0.35);

  return Buffer.from(`
    <svg width="${boxWidth}" height="${boxHeight}" viewBox="0 0 ${boxWidth} ${boxHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          @font-face {
            font-family: 'Roboto-Bold';
            src: url('${fontPath}');
          }
          .watermark-text {
            font-family: 'Roboto-Bold', Arial, Helvetica, sans-serif;
            font-size: ${fontSize}px;
            font-weight: 700;
            fill: #1E293B;
          }
        </style>
      </defs>
      <!-- Clean, subtle background without harsh borders -->
      <rect x="0" y="0" width="${boxWidth}" height="${boxHeight}" rx="${radius}" fill="rgba(255,255,255,0.85)"/>
      <rect x="0.5" y="0.5" width="${boxWidth - 1}" height="${boxHeight - 1}" rx="${radius}" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="1"/>
      <text x="${boxWidth / 2}" y="${textY}" text-anchor="middle" class="watermark-text">${escapeSvgText(text)}</text>
    </svg>
  `);
};

export const applyDesignNumberToBanner = async ({
  imageUrl,
  designNumber,
  widthCm,
  heightCm,
}: {
  imageUrl: string;
  designNumber: string;
  widthCm?: number;
  heightCm?: number;
}) => {
  if (!imageUrl) {
    throw new AppError("Afbeelding-URL van banner ontbreekt", 400);
  }

  if (!designNumber) {
    throw new AppError("Ontwerpnummer ontbreekt", 400);
  }

  let fetchUrl = imageUrl;
  if (!fetchUrl.startsWith("http://") && !fetchUrl.startsWith("https://")) {
    const baseUrl = process.env.SERVER_URL || process.env.CLIENT_URL || "http://localhost:5000";
    fetchUrl = `${baseUrl.replace(/\/$/, "")}/${fetchUrl.replace(/^\//, "")}`;
  }

  const response = await axios.get<ArrayBuffer>(fetchUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
  });

  const image = sharp(Buffer.from(response.data)).rotate();
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new AppError("Kan afmetingen van banner-afbeelding niet lezen", 400);
  }

  const watermark = getWatermarkSvg({
    text: designNumber,
    width: metadata.width,
    height: metadata.height,
    widthCm,
    heightCm,
  });

  const watermarkMetadata = await sharp(watermark).metadata();
  const watermarkWidth = Number(watermarkMetadata.width || 0);
  const watermarkHeight = Number(watermarkMetadata.height || 0);

  // Determine pixel density (pxPerCm) for margin
  let pxPerCm = 0;
  if (widthCm && widthCm > 0) {
    pxPerCm = metadata.width / widthCm;
  } else if (heightCm && heightCm > 0) {
    pxPerCm = metadata.height / heightCm;
  } else {
    pxPerCm = metadata.width / 120;
  }

  // Client requirement: "The number can be placed right at the bottom edge, as close to the corner as possible."
  // Right at the bottom edge (~1mm margin) to completely avoid the grommet punch area (which is ~15-20mm inset)
  const marginX = Math.max(1, Math.round(0.15 * pxPerCm)); // ~1.5mm from right edge
  const marginY = Math.max(1, Math.round(0.10 * pxPerCm)); // ~1.0mm from bottom edge (right at the edge)

  const left = Math.max(0, metadata.width - watermarkWidth - marginX);
  const top = Math.max(0, metadata.height - watermarkHeight - marginY);

  const finalImageBuffer = await image
    .composite([
      {
        input: watermark,
        left,
        top,
      },
    ])
    .png()
    .toBuffer();

  const key = `final-banners/${Date.now()}-${designNumber}.png`;

  return uploadBufferToS3({
    buffer: finalImageBuffer,
    key,
    contentType: "image/png",
  });
};
