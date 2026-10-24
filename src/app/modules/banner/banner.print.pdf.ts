import PDFDocument from "pdfkit";
import axios from "axios";
import { AppError } from "../../error/AppError";

interface GeneratePrintPdfOptions {
  banner: {
    id: string;
    headline?: string | null;
    name?: string | null;
    width: number; // in cm
    height: number; // in cm
    imageUrl?: string | null;
    originalImageUrl?: string | null;
    material?: string | null;
    eyeletType?: string | null;
    orderId?: string | null;
    designNumber?: string | null;
  };
  bleedMm?: number;
  includeCropMarks?: boolean;
}

const CM_TO_PT = 72 / 2.54; // ~28.3464567 pt per cm
const MM_TO_PT = CM_TO_PT / 10; // ~2.83464567 pt per mm

/**
 * Generates a 1:1 scale print-ready PDF for commercial printing presses (e.g. Onyx, Caldera, VersaWorks).
 * Embeds uncompressed/original high-resolution raster image or canvas render with exact physical millimeter sizing.
 */
export const generateBannerPrintPdf = async ({
  banner,
  bleedMm = 0,
  includeCropMarks = false,
}: GeneratePrintPdfOptions): Promise<Buffer> => {
  const widthCm = banner.width || 120;
  const heightCm = banner.height || 80;

  const widthPt = widthCm * CM_TO_PT;
  const heightPt = heightCm * CM_TO_PT;

  const effectiveBleedMm = Math.max(0, bleedMm);
  const bleedPt = effectiveBleedMm * MM_TO_PT;

  const pageWidthPt = widthPt + bleedPt * 2;
  const pageHeightPt = heightPt + bleedPt * 2;

  const primarySource = banner.originalImageUrl || banner.imageUrl;
  if (!primarySource) {
    throw new AppError("Geen afbeeldingsbron gevonden voor deze banner", 400);
  }

  // Fetch the highest resolution image available with fallback
  let imageBuffer: Buffer;
  try {
    const response = await axios.get(primarySource, {
      responseType: "arraybuffer",
      timeout: 45000,
    });
    imageBuffer = Buffer.from(response.data);
  } catch (primaryErr: any) {
    if (banner.imageUrl && banner.imageUrl !== primarySource) {
      console.warn(
        `Failed to fetch primary image ${primarySource}, trying fallback ${banner.imageUrl}:`,
        primaryErr?.message,
      );
      const fallbackResponse = await axios.get(banner.imageUrl, {
        responseType: "arraybuffer",
        timeout: 45000,
      });
      imageBuffer = Buffer.from(fallbackResponse.data);
    } else {
      throw primaryErr;
    }
  }

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: [pageWidthPt, pageHeightPt],
        margin: 0,
        bufferPages: false,
        autoFirstPage: true,
        info: {
          Title: `Drukbestand - ${banner.headline || banner.name || "Spandoek"} - ${widthCm}x${heightCm}cm`,
          Author: "Spandoekprint (Basione)",
          Subject: `Spandoek Drukbestand ${widthCm}x${heightCm} cm | Materiaal: ${banner.material || "Frontlit 510g"} | Afwerking: ${banner.eyeletType || "Ringen rondom"}`,
          Keywords: "drukbestand, print-ready, high-resolution, banner, spandoek",
          Creator: "Basione Print Engine",
          Producer: "PDFKit / Basione",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Embed high-res image at 1:1 physical dimensions
      if (bleedPt > 0) {
        // When bleed is requested, image fills the entire bleed canvas
        doc.image(imageBuffer, 0, 0, {
          width: pageWidthPt,
          height: pageHeightPt,
        });

        // Optionally draw subtle crop marks at the 4 corners of the trim box
        if (includeCropMarks) {
          const markLength = 5 * MM_TO_PT;
          const markOffset = 2 * MM_TO_PT;

          doc.save();
          doc.lineWidth(0.5);
          doc.strokeColor("#000000");

          const x0 = bleedPt;
          const x1 = pageWidthPt - bleedPt;
          const y0 = bleedPt;
          const y1 = pageHeightPt - bleedPt;

          // Top-Left corner marks
          doc.moveTo(x0, y0 - markOffset).lineTo(x0, y0 - markOffset - markLength).stroke();
          doc.moveTo(x0 - markOffset, y0).lineTo(x0 - markOffset - markLength, y0).stroke();

          // Top-Right corner marks
          doc.moveTo(x1, y0 - markOffset).lineTo(x1, y0 - markOffset - markLength).stroke();
          doc.moveTo(x1 + markOffset, y0).lineTo(x1 + markOffset + markLength, y0).stroke();

          // Bottom-Left corner marks
          doc.moveTo(x0, y1 + markOffset).lineTo(x0, y1 + markOffset + markLength).stroke();
          doc.moveTo(x0 - markOffset, y1).lineTo(x0 - markOffset - markLength, y1).stroke();

          // Bottom-Right corner marks
          doc.moveTo(x1, y1 + markOffset).lineTo(x1, y1 + markOffset + markLength).stroke();
          doc.moveTo(x1 + markOffset, y1).lineTo(x1 + markOffset + markLength, y1).stroke();

          doc.restore();
        }
      } else {
        // Exact trim size (0 bleed) - perfect 1:1 scale for automated CNC cutters and direct print
        doc.image(imageBuffer, 0, 0, {
          width: widthPt,
          height: heightPt,
        });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
