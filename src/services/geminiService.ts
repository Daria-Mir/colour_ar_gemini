import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface ColorAnalysis {
  season: string;
  undertone: string;
  skinTone: string;
  contrast: string;
  eyeColor: string;
  hairColor: string;
  description: string;
  bestColors: { hex: string; name: string }[];
  avoidColors: { hex: string; name: string }[];
  neutrals: { hex: string; name: string }[];
  lipShades: { hex: string; name: string }[];
}

export interface Product {
  brand: string;
  name: string;
  shade: string;
  hex: string;
  price: string;
  reason: string;
  sephora_url: string;
}

export async function analyzeColors(base64Image: string, mimeType: string): Promise<ColorAnalysis> {
  const prompt = `You are an expert color analyst. Analyze this person's face and provide a detailed color season analysis.
Respond with a JSON object following this structure. 

Important: Return ONLY the JSON object.

Structure:
{
  "season": "string",
  "undertone": "string",
  "skinTone": "string",
  "contrast": "string",
  "eyeColor": "string",
  "hairColor": "string",
  "description": "string",
  "bestColors": [{"hex":"#hex","name":"name"}],
  "avoidColors": [{"hex":"#hex","name":"name"}],
  "neutrals": [{"hex":"#hex","name":"name"}],
  "lipShades": [{"hex":"#hex","name":"name"}]
}`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      { text: prompt },
      {
        inlineData: {
          data: base64Image,
          mimeType: mimeType,
        },
      },
    ],
    config: {
      responseMimeType: "application/json",
    }
  });

  const text = response.text || "";
  return JSON.parse(text);
}

export async function findProducts(analysis: ColorAnalysis, category: string, subcategories: string[]): Promise<Product[]> {
  const paletteDesc = analysis.bestColors.map(c => c.name).join(", ");
  const lipDesc = analysis.lipShades.map(c => `${c.name} (${c.hex})`).join(", ");

  const prompt = `You are a beauty and fashion product expert. Based on this person's color analysis, recommend specific real products.

Color season: ${analysis.season}
Undertone: ${analysis.undertone}
Skin tone: ${analysis.skinTone}
Best palette colors: ${paletteDesc}
Best lip shades: ${lipDesc}
Shopping for: ${subcategories.join(", ")} (category: ${category})

Respond with a JSON array of exactly 5 product recommendations.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            brand: { type: Type.STRING },
            name: { type: Type.STRING },
            shade: { type: Type.STRING },
            hex: { type: Type.STRING },
            price: { type: Type.STRING },
            reason: { type: Type.STRING },
            sephora_url: { type: Type.STRING }
          },
          required: ["brand", "name", "shade", "hex", "price", "reason", "sephora_url"]
        }
      }
    }
  });

  const text = response.text || "";
  return JSON.parse(text);
}
