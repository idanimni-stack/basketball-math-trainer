// 🏀 Basketball Math Trainer - Backend Server
// משרת את ה-frontend ומספק API לניתוח תמונות פתרון בכתב יד

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';

if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY חסר! הגדר משתנה סביבה.');
  process.exit(1);
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // עד 10MB לתמונות
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting - מקסימום 30 בקשות לדקה לכל IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'יותר מדי בקשות. אנא המתן דקה ונסה שוב.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Serve static files (ה-frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: GEMINI_MODEL, timestamp: new Date().toISOString() });
});

// 🎯 Main endpoint - ניתוח תמונת פתרון
app.post('/api/analyze-solution', apiLimiter, async (req, res) => {
  try {
    const { imageBase64, question, correctAnswer, topic, studentName } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'חסרה תמונה' });
    }
    if (!question) {
      return res.status(400).json({ error: 'חסרה שאלה' });
    }

    // הסרת prefix של data URL אם קיים
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    // זיהוי mime type מהתמונה
    let mimeType = 'image/jpeg';
    if (imageBase64.startsWith('data:image/png')) mimeType = 'image/png';
    else if (imageBase64.startsWith('data:image/webp')) mimeType = 'image/webp';
    else if (imageBase64.startsWith('data:image/heic')) mimeType = 'image/heic';

    // 🎯 ה-prompt המקצועי בעברית
    const systemPrompt = `אתה מאמן מתמטיקה ידידותי ומעודד לילד בכיתה ד' בישראל${studentName ? ` בשם ${studentName}` : ''}.
אתה רואה תמונה של פתרון תרגיל במתמטיקה שנכתב בעיפרון על דף נייר בכתב יד של ילד.

📚 פרטי התרגיל:
- השאלה שניתנה: "${question}"
- התשובה הנכונה: "${correctAnswer || 'לא צוין'}"
- הנושא: ${topic || 'מתמטיקה כללית'}

🎯 המשימה שלך - בצע בעיון:

1. **קרא בקפידה את כתב היד** - הילד כתב בעיפרון, אולי בכתב לא תמיד ברור. נסה לזהות מספרים, סימני פעולה (+, -, ×, ÷, =), שברים (קו אופקי עם מספרים מעל ומתחת), וסימני זוויות.

2. **זהה את כל השלבים** של הפתרון - גם אם הילד כתב במהירות, נסה להבין את סדר הפעולות שלו.

3. **בדוק כל שלב מתמטית** - האם החישוב נכון? האם הוא הבין את השאלה?

4. **זהה איפה טעה** (אם טעה) - שגיאת חישוב? שגיאה בהבנת השאלה? פעולה לא נכונה?

5. **גם אם התשובה הסופית נכונה** - בדוק אם הדרך נכונה. ילד יכול להגיע לתשובה נכונה במזל או בדרך לא יעילה.

6. **תן פידבק חם בסגנון מאמן כדורסל** - השתמש בביטויי כדורסל כמו "מהלך יפה!", "כמעט סל!", "MVP!", "החטאה קלה", "פגיעה מדויקת!"

⚠️ כללים חשובים:
- אם התמונה לא ברורה / חשוכה / מטושטשת - אמור זאת בעדינות ובקש לצלם שוב
- אם אתה לא רואה פתרון בתמונה (רק דף ריק / משהו אחר) - ציין זאת
- אל תהיה ביקורתי או נוקשה - תעודד תמיד
- השתמש בשפה פשוטה לכיתה ד'
- אם הילד שגה - הסבר ספציפית **איפה** ו**איך** לתקן בפעם הבאה
- ענה תמיד בעברית

🎁 פורמט תגובה - JSON בלבד, אין טקסט מחוץ ל-JSON:

{
  "imageReadable": true או false,
  "imageIssue": "אם התמונה לא קריאה - מה הבעיה",
  "studentAnswer": "התשובה הסופית שהילד כתב (כפי שזיהית)",
  "isCorrect": true או false,
  "stepsIdentified": [
    {
      "stepNumber": 1,
      "whatStudentDid": "תיאור מה הילד עשה בשלב הזה",
      "isStepCorrect": true או false,
      "comment": "הערה קצרה"
    }
  ],
  "mistakeFound": true או false,
  "mistakeLocation": "באיזה שלב טעה ומה היה הטעות (ריק אם אין טעות)",
  "correctApproach": "הסבר שלב-אחר-שלב של הדרך הנכונה לפתור",
  "coachFeedback": "פידבק חם ומעודד בסגנון מאמן כדורסל (2-3 משפטים)",
  "nextTimeAdvice": "טיפ קצר לפעם הבאה",
  "overallScore": מספר בין 1 ל-5 (כמה טוב הפתרון בסך הכל)
}`;

    // קריאה ל-Gemini API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiBody = {
      contents: [{
        parts: [
          { text: systemPrompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: cleanBase64
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.4,
        topP: 0.95,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        thinkingConfig: {
          thinkingBudget: 0
        }
      }
    };

    console.log(`📸 מנתח תמונה לשאלה: ${question.substring(0, 50)}...`);

    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      return res.status(500).json({
        error: 'שגיאה בניתוח התמונה. אנא נסה שוב.',
        details: process.env.NODE_ENV === 'development' ? errorText : undefined
      });
    }

    const geminiData = await geminiResponse.json();

    // חילוץ התשובה
    const responseText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      return res.status(500).json({ error: 'תגובה ריקה מהמודל' });
    }

    let analysis;
    try {
      analysis = JSON.parse(responseText);
    } catch (e) {
      // נסה לנקות מ- markdown code blocks אם קיימים
      try {
        const cleaned = responseText
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();
        analysis = JSON.parse(cleaned);
      } catch (e2) {
        console.error('JSON parse error. Raw response:', responseText.substring(0, 500));
        console.error('Finish reason:', geminiData?.candidates?.[0]?.finishReason);
        return res.status(500).json({
          error: 'שגיאה בעיבוד התגובה',
          finishReason: geminiData?.candidates?.[0]?.finishReason
        });
      }
    }

    console.log(`✅ ניתוח הושלם. תשובה נכונה: ${analysis.isCorrect}`);

    res.json({
      success: true,
      analysis,
      model: GEMINI_MODEL,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      error: 'שגיאה בשרת. אנא נסה שוב.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Fallback - שלח את index.html לכל request אחר (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🏀 Basketball Math Trainer Backend running on port ${PORT}`);
  console.log(`📡 Using model: ${GEMINI_MODEL}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
});
