import { GoogleGenAI, Tool } from "@google/genai";
import { Category, GeoLocation, PlaceLink, Recommendation } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const CONTINENTS = [
  "亞洲", "歐洲", "北美洲", "南美洲", "非洲", "大洋洲", "島嶼國家"
];

export const getTravelRecommendation = async (
  category: Category,
  location: GeoLocation | null
): Promise<Recommendation> => {
  const isNearby = !!location;
  
  // Constructing a prompt that encourages randomness and specificity
  let prompt = "";
  let toolConfig = {};

  if (isNearby && location) {
    prompt = `
      請在我目前的經緯度 (${location.lat}, ${location.lng}) 附近，
      推薦一個適合「${category === Category.ALL ? '旅遊' : category}」的地點。
      這應該是一個值得造訪的具體景點、餐廳或地標。
      
      請詳細介紹這個地方的特色、為什麼值得去，以及參觀的小撇步。
      語氣要像一個熱情的在地嚮導。
      請確保使用 Google Maps 工具來驗證地點並獲取連結。
    `;
    
    toolConfig = {
      retrievalConfig: {
        latLng: {
          latitude: location.lat,
          longitude: location.lng
        }
      }
    };
  } else {
    const randomContinent = CONTINENTS[Math.floor(Math.random() * CONTINENTS.length)];
    prompt = `
      請扮演一位世界旅行家。
      請在「${randomContinent}」地區，隨機挑選一個國家與城市，
      並推薦一個具體的「${category === Category.ALL ? '旅遊' : category}」景點。
      
      請不要總是推薦最著名的景點（如艾菲爾鐵塔），嘗試推薦一些獨特、美麗或有趣的景點。
      請詳細介紹這個地方的：
      1. 景點名稱與地點
      2. 為什麼它很迷人
      3. 適合的旅遊季節或時間
      
      語氣要充滿探索的興奮感。
      請務必使用 Google Maps 工具來提供準確的地點資訊。
    `;
  }

  const tools: Tool[] = [{ googleMaps: {} }];

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: tools,
        ...(isNearby ? { toolConfig } : {}),
        systemInstruction: "你是一個專業的旅遊顧問與嚮導，擅長發掘世界各地或使用者身邊的有趣景點。你的回答應該是繁體中文(Traditional Chinese)。",
        temperature: 1.2, // Higher temperature for more randomness
      },
    });

    const text = response.text || "抱歉，我現在無法找到推薦的地點，請稍後再試。";
    
    const links: PlaceLink[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;

    if (chunks) {
      chunks.forEach((chunk: any) => {
        if (chunk.maps?.uri && chunk.maps?.title) {
          links.push({
            title: chunk.maps.title,
            uri: chunk.maps.uri
          });
        }
      });
    }

    return {
      content: text,
      links: links,
      timestamp: Date.now()
    };

  } catch (error) {
    console.error("Gemini API Error:", error);
    throw new Error("無法取得景點推薦，請檢查網路連線或稍後再試。");
  }
};