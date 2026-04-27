import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.post("/api/send-emails", async (req, res) => {
    const { recipients, smtpConfig, emailTemplate } = req.body;

    if (!recipients || !smtpConfig) {
      return res.status(400).json({ error: "Missing recipients or SMTP configuration" });
    }

    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: Number(smtpConfig.port),
      secure: Number(smtpConfig.port) === 465,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass,
      },
    });

    // Verify connection
    try {
      await transporter.verify();
    } catch (error) {
      return res.status(500).json({ error: "SMTP Verification failed: " + (error as Error).message });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendProgress = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const total = recipients.length;
    let sentCount = 0;
    let errorCount = 0;

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      
      try {
        // Human-like behavior: Batching
        if (i > 0 && i % 10 === 0) {
          sendProgress({ status: 'info', message: 'Batch complete. Pausing for 30s to mimic human behavior...' });
          await new Promise(resolve => setTimeout(resolve, 30000));
        }

        // Random interval between emails (30-90s)
        if (i > 0) {
          const delay = Math.floor(Math.random() * (90000 - 30000 + 1) + 30000);
          sendProgress({ status: 'info', message: `Waiting ${Math.round(delay/1000)}s before next email...` });
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        await transporter.sendMail({
          from: `"CertiFlow" <${smtpConfig.user}>`,
          to: recipient.email,
          subject: emailTemplate.subject,
          text: emailTemplate.body.replace(/{{name}}/g, recipient.name),
          attachments: [
            {
              filename: `Certificate_${recipient.name.replace(/\s+/g, '_')}.pdf`,
              content: recipient.pdfBase64,
              encoding: 'base64'
            }
          ]
        });

        sentCount++;
        sendProgress({ 
          status: 'success', 
          message: `Successfully sent to ${recipient.email}`, 
          progress: { current: i + 1, total, sent: sentCount, errors: errorCount } 
        });

      } catch (error) {
        errorCount++;
        sendProgress({ 
          status: 'error', 
          message: `Failed sending to ${recipient.email}: ${(error as Error).message}`,
          progress: { current: i + 1, total, sent: sentCount, errors: errorCount }
        });
      }
    }

    sendProgress({ status: 'done', message: 'Automation complete', summary: { total, sent: sentCount, errors: errorCount } });
    res.end();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
