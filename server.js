// 🏀 Study Trainer Backend v2 - Multi-student, Multi-plan, AI-powered
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
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
  console.error('❌ GEMINI_API_KEY חסר!');
  process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'יותר מדי בקשות. אנא המתן דקה.' }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: GEMINI_MODEL, version: '2.0.0' });
});

// ====================================================================
// 🤖 פונקציית עזר - קריאה ל-Gemini
// ====================================================================
async function callGemini(parts, options = {}) {
  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: options.temperature || 0.5,
      topP: 0.95,
      maxOutputTokens: options.maxOutputTokens || 8192,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 }
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${errorText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('תגובה ריקה מהמודל');

  try {
    return JSON.parse(text);
  } catch (e) {
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(cleaned);
  }
}

function detectMimeType(dataUrl) {
  if (dataUrl.startsWith('data:image/png')) return 'image/png';
  if (dataUrl.startsWith('data:image/webp')) return 'image/webp';
  if (dataUrl.startsWith('data:image/heic')) return 'image/heic';
  if (dataUrl.startsWith('data:application/pdf')) return 'application/pdf';
  if (dataUrl.startsWith('data:application/vnd.openxmlformats')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'image/jpeg';
}

function stripDataPrefix(dataUrl) {
  return dataUrl.replace(/^data:[^;]+;base64,/, '');
}

// ====================================================================
// 📚 Endpoint 1: ניתוח חומר לימוד ובניית תוכנית
// ====================================================================
app.post('/api/create-study-plan', apiLimiter, async (req, res) => {
  try {
    const { subject, studentName, studentGrade, examDate, dailyMinutes, restDays, materials, freeText } = req.body;

    if (!subject) return res.status(400).json({ error: 'חסר שם המקצוע' });
    if (!materials?.length && !freeText?.trim()) {
      return res.status(400).json({ error: 'חסר חומר לימוד - העלה קבצים או הקלד טקסט' });
    }

    console.log(`📚 בונה תוכנית: ${subject} ל-${studentName || 'תלמיד'}`);

    // שלב 1: ניתוח החומר וזיהוי נושאים
    const analysisPrompt = `אתה מורה מומחה לבית ספר יסודי. אתה רואה חומר לימוד עבור תלמיד${studentName ? ` בשם ${studentName}` : ''}${studentGrade ? ` בכיתה ${studentGrade}` : ''} למקצוע "${subject}".

המשימה שלך:
1. עיין בחומר המצורף (קבצים ו/או טקסט חופשי)
2. זהה את כל הנושאים והתת-נושאים שיש ללמוד
3. הערך את רמת הקושי של כל נושא לתלמיד בכיתה זו

⚠️ חשוב: המקצוע הוא "${subject}". אם זו אנגלית - הנושאים יכולים להיות אוצר מילים, זמני פעלים, קריאה, וכו'. אם זו מתמטיקה - שברים, כפל, גיאומטריה, וכו'.

החזר JSON במבנה:
{
  "detectedSubject": "שם המקצוע שזיהית בחומר",
  "language": "hebrew" או "english" או "mixed",
  "topics": [
    {
      "id": "topic_unique_id",
      "name": "שם הנושא בעברית",
      "nameInOriginalLanguage": "השם בשפת המקצוע (לאנגלית - באנגלית)",
      "subtopics": ["תת-נושא 1", "תת-נושא 2"],
      "difficulty": "easy" / "medium" / "hard",
      "estimatedSessionsToMaster": מספר בין 1-4,
      "exampleQuestionTypes": ["סוג שאלה 1", "סוג שאלה 2"]
    }
  ],
  "totalEstimatedSessions": מספר כולל מומלץ של סשני לימוד,
  "studyTips": "טיפים ללמידה של החומר הזה (2-3 משפטים)"
}

${freeText ? `\n📝 טקסט חופשי שהוזן:\n${freeText}\n` : ''}`;

    const parts = [{ text: analysisPrompt }];

    // הוסף את הקבצים שהועלו
    if (materials && materials.length > 0) {
      for (const mat of materials) {
        if (mat.dataUrl) {
          parts.push({
            inline_data: {
              mime_type: detectMimeType(mat.dataUrl),
              data: stripDataPrefix(mat.dataUrl)
            }
          });
        }
      }
    }

    const analysis = await callGemini(parts, { temperature: 0.3, maxOutputTokens: 8192 });

    // שלב 2: ייצור שאלות לכל נושא
    console.log(`🎯 מייצר שאלות ל-${analysis.topics.length} נושאים`);

    const questionsByTopic = {};
    for (const topic of analysis.topics) {
      const questionsPrompt = `אתה מורה ל${subject} בכיתה ${studentGrade || 'יסודי'}.
צור 12 שאלות תרגול לנושא: "${topic.name}" (${topic.nameInOriginalLanguage || topic.name})
תת-נושאים: ${topic.subtopics.join(', ')}

דרישות:
- 4 שאלות ברמה קלה
- 5 שאלות ברמה בינונית
- 3 שאלות ברמה קשה
- שאלות מגוונות ולא חוזרות
- ${analysis.language === 'english' ? 'השאלות בעיקר באנגלית, ההסברים בעברית' : 'הכל בעברית, אבל מספרים וביטויים מתמטיים LTR'}

⚠️ פורמט מתמטי חשוב:
- שאלות מתמטיות ייכתבו כך שמספרים יופיעו LTR: "24 × 5 = ?" ולא הפוך
- שברים: השתמש בפורמט "1/2" או "3/4"
- אם יש טקסט מילולי עברי לפני המספרים, כתוב את כל המשפט וסמן את החישוב בסוגריים

החזר JSON:
{
  "questions": [
    {
      "id": "q_unique_id",
      "type": "multiple_choice" / "open" / "fill_in",
      "questionText": "טקסט השאלה",
      "questionMath": "אם יש חישוב מתמטי - בנפרד (לדוגמה '24 × 5')",
      "options": ["אופציה 1", "אופציה 2", "אופציה 3", "אופציה 4"] (רק אם type=multiple_choice),
      "correctAnswer": "התשובה הנכונה",
      "explanation": "הסבר שלב-אחר-שלב בעברית, פונה לתלמיד בגוף שני (אתה/את)",
      "difficulty": "easy" / "medium" / "hard",
      "hint": "רמז קצר במידה והתלמיד נתקע"
    }
  ]
}`;

      try {
        const result = await callGemini([{ text: questionsPrompt }], { temperature: 0.7, maxOutputTokens: 8192 });
        questionsByTopic[topic.id] = result.questions || [];
        console.log(`  ✓ ${topic.name}: ${result.questions?.length || 0} שאלות`);
      } catch (e) {
        console.error(`  ✗ ${topic.name}: ${e.message}`);
        questionsByTopic[topic.id] = [];
      }
    }

    // שלב 3: בניית תוכנית האימונים לפי תאריך
    const examDateObj = new Date(examDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysUntilExam = Math.max(1, Math.ceil((examDateObj - today) / (1000 * 60 * 60 * 24)));

    const trainingPlan = buildTrainingPlan({
      topics: analysis.topics,
      daysUntilExam,
      restDays: restDays || [6],
      examDate
    });

    res.json({
      success: true,
      plan: {
        subject,
        detectedSubject: analysis.detectedSubject,
        language: analysis.language,
        examDate,
        dailyMinutes: dailyMinutes || 15,
        restDays: restDays || [6],
        topics: analysis.topics,
        questionsByTopic,
        trainingPlan,
        studyTips: analysis.studyTips,
        totalEstimatedSessions: analysis.totalEstimatedSessions,
        createdAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Create plan error:', error);
    res.status(500).json({ error: 'שגיאה ביצירת תוכנית: ' + error.message });
  }
});

// ====================================================================
// 📅 בניית תוכנית אימונים יומית
// ====================================================================
function buildTrainingPlan({ topics, daysUntilExam, restDays, examDate }) {
  const plan = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let day = 0;
  let date = new Date(today);

  // חישוב ימי אימון אפקטיביים
  const effectiveDays = [];
  for (let i = 0; i < daysUntilExam; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    if (!restDays.includes(d.getDay())) {
      effectiveDays.push(new Date(d));
    }
  }

  if (effectiveDays.length === 0) {
    effectiveDays.push(new Date(today));
  }

  // שלב יסודות (33%)
  const phase1End = Math.floor(effectiveDays.length * 0.33);
  // שלב חיזוק (33-66%)
  const phase2End = Math.floor(effectiveDays.length * 0.66);

  // יום 1: מבחן אבחון
  plan.push({
    day: 1,
    date: effectiveDays[0].toISOString().split('T')[0],
    phase: 'אבחון',
    title: 'מבחן רמה ראשוני 🎯',
    description: 'בוא נראה איפה אתה עומד בכל הנושאים',
    topicIds: topics.map(t => t.id),
    isDiagnostic: true,
    questionsCount: 12
  });

  // שלב יסודות - עבור על כל הנושאים
  let currentDayIndex = 1;
  const topicsForPhase1 = topics.slice();
  while (currentDayIndex < phase1End && topicsForPhase1.length > 0) {
    const topic = topicsForPhase1.shift();
    plan.push({
      day: currentDayIndex + 1,
      date: effectiveDays[currentDayIndex].toISOString().split('T')[0],
      phase: 'חימום על המגרש 🔥',
      title: topic.name,
      description: `יסודות הנושא: ${topic.subtopics.slice(0, 2).join(', ')}`,
      topicIds: [topic.id],
      questionsCount: 10
    });
    currentDayIndex++;
  }

  // שלב חיזוק - חוזרים על נושאים קשים
  while (currentDayIndex < phase2End) {
    const topic = topics[currentDayIndex % topics.length];
    plan.push({
      day: currentDayIndex + 1,
      date: effectiveDays[currentDayIndex].toISOString().split('T')[0],
      phase: 'אימוני כוח 💪',
      title: `חיזוק: ${topic.name}`,
      description: 'תרגול מעמיק עם דגש על אתגרים',
      topicIds: [topic.id],
      questionsCount: 10
    });
    currentDayIndex++;
  }

  // שלב שיא - תרגול מעורב
  while (currentDayIndex < effectiveDays.length - 1) {
    plan.push({
      day: currentDayIndex + 1,
      date: effectiveDays[currentDayIndex].toISOString().split('T')[0],
      phase: 'משחקי ליגה 🏆',
      title: 'תרגול מעורב',
      description: 'שאלות אקראיות מכל הנושאים - הכנה למבחן',
      topicIds: topics.map(t => t.id),
      questionsCount: 10
    });
    currentDayIndex++;
  }

  // יום לפני המבחן - אימון קל
  if (currentDayIndex < effectiveDays.length) {
    plan.push({
      day: currentDayIndex + 1,
      date: effectiveDays[currentDayIndex].toISOString().split('T')[0],
      phase: 'ערב לפני הקרב 🌙',
      title: 'אימון קל לפני המבחן',
      description: 'חזרה קצרה ועידוד אחרון',
      topicIds: topics.map(t => t.id),
      questionsCount: 5,
      isLight: true
    });
  }

  return plan;
}

// ====================================================================
// 📸 Endpoint 2: ניתוח תמונת פתרון (כמו v1, אבל גם תומך באנגלית)
// ====================================================================
app.post('/api/analyze-solution', apiLimiter, async (req, res) => {
  try {
    const { imageBase64, question, correctAnswer, topic, studentName, subject } = req.body;

    if (!imageBase64) return res.status(400).json({ error: 'חסרה תמונה' });
    if (!question) return res.status(400).json({ error: 'חסרה שאלה' });

    const cleanBase64 = stripDataPrefix(imageBase64);
    const mimeType = detectMimeType(imageBase64);

    const subjectLabel = subject === 'english' ? 'אנגלית' : 'מתמטיקה';
    const studentRef = studentName || 'התלמיד';

    const systemPrompt = `אתה מאמן ${subjectLabel} ידידותי וחם שמדבר ישירות אל ${studentRef}.
אתה רואה תמונה של פתרון שנכתב בעיפרון על דף נייר בכתב יד.

📚 פרטי התרגיל:
- השאלה המדויקת: "${question}"
- התשובה הנכונה הצפויה: "${correctAnswer || 'לא צוין'}"
- הנושא: ${topic || subjectLabel}

🎯 המשימה:

## שלב א' - בדיקת התאמת התרגיל (קריטי!) ⚠️
קודם כל, וודא ש${studentRef} פתר את התרגיל הנכון! ("${question}")
- אם פתר תרגיל **אחר לגמרי** (סימן שונה, מספרים שונים) - זה הדבר הכי חשוב לציין!

## שלב ב' - ניתוח הפתרון
1. קרא בקפידה את כתב היד
2. זהה את כל השלבים
3. בדוק כל שלב מתמטית/לשונית
4. זהה איפה טעה (אם טעה)

## שלב ג' - ניסוח הפידבק 💬
**חוק זהב: דבר ישירות אל ${studentRef} בגוף שני ("אתה", "שלך"), לא בגוף שלישי!**

דוגמאות נכונות:
✅ "אני רואה שצמצמת את השבר ל-1/2"
✅ "בשלב הזה חיברת את המונים"
✅ "כאן עשית כפל יפה"

דוגמאות שגויות:
❌ "${studentRef} צמצם את השבר"
❌ "התלמיד חיבר"

השתמש בביטויי כדורסל: "מהלך יפה!", "כמעט סל!", "MVP!", "פגיעה מדויקת!", "Slam Dunk!"

⚠️ חוקים:
- אם התמונה לא ברורה - אמור זאת ובקש לצלם שוב
- אם אין פתרון בתמונה - ציין זאת
- ענה תמיד בעברית (גם אם המקצוע אנגלית - ההסברים בעברית)
- דבר בגוף שני!

🎁 JSON בלבד:
{
  "imageReadable": true או false,
  "imageIssue": "אם התמונה לא קריאה - מה הבעיה",
  "wrongExercise": true אם פתר תרגיל שונה לחלוטין,
  "exerciseInImage": "איזה תרגיל אתה רואה בתמונה",
  "exerciseMismatchExplanation": "הסבר ידידותי בגוף שני אם פתר תרגיל אחר",
  "studentAnswer": "התשובה הסופית שכתבת",
  "isCorrect": true או false,
  "stepsIdentified": [
    {
      "stepNumber": 1,
      "whatStudentDid": "בגוף שני - 'אתה חיברת...', 'כאן צמצמת...'",
      "isStepCorrect": true או false,
      "comment": "הערה קצרה"
    }
  ],
  "mistakeFound": true או false,
  "mistakeLocation": "הסבר הטעות בגוף שני",
  "correctApproach": "הדרך הנכונה - בגוף שני",
  "coachFeedback": "פידבק חם בגוף שני, סגנון כדורסל",
  "nextTimeAdvice": "טיפ לפעם הבאה בגוף שני",
  "overallScore": 1-5
}`;

    const result = await callGemini([
      { text: systemPrompt },
      { inline_data: { mime_type: mimeType, data: cleanBase64 } }
    ], { temperature: 0.4, maxOutputTokens: 8192 });

    res.json({ success: true, analysis: result });

  } catch (error) {
    console.error('Analyze error:', error);
    res.status(500).json({ error: 'שגיאה בניתוח: ' + error.message });
  }
});

// ====================================================================
// 🔄 Fallback - שלח את index.html
// ====================================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🏀 Study Trainer v2 running on port ${PORT}`);
  console.log(`📡 Model: ${GEMINI_MODEL}`);
});
