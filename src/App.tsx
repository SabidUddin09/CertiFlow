import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileUp, 
  Settings2, 
  Mail, 
  CheckCircle2, 
  AlertCircle, 
  ChevronRight, 
  ChevronLeft,
  X,
  Target,
  Send,
  Loader2,
  Table as TableIcon,
  FileText
} from 'lucide-react';
import { Recipient, FieldMapping, SMTPConfig, EmailTemplate, Progress } from './types';

// Utility for merging classes
export function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}

export default function App() {
  const [step, setStep] = useState(1);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string>('');
  const [excelData, setExcelData] = useState<Recipient[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, FieldMapping>>({});
  const [activeMapping, setActiveMapping] = useState<string | null>(null);
  
  const [smtpConfig, setSmtpConfig] = useState<SMTPConfig>({
    host: 'smtp.gmail.com',
    port: '587',
    user: '',
    pass: ''
  });
  
  const [emailTemplate, setEmailTemplate] = useState<EmailTemplate>({
    subject: 'Your Certificate of Completion',
    body: 'Hello {{name}},\n\nPlease find your certificate attached.\n\nBest regards,\nThe Team'
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<{status: string, message: string}[]>([]);
  const [overallProgress, setOverallProgress] = useState<Progress | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPdfFile(file);
      const arrayBuffer = await file.arrayBuffer();
      setPdfData(new Uint8Array(arrayBuffer));
      const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
    }
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as Recipient[];
        setExcelData(data);
        if (data.length > 0) {
          setHeaders(Object.keys(data[0]));
        }
      };
      reader.readAsBinaryString(file);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!activeMapping || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const pdfX = (x / rect.width);
    const pdfY = 1 - (y / rect.height);

    setMappings(prev => ({
      ...prev,
      [activeMapping]: {
        column: activeMapping,
        x: pdfX,
        y: pdfY,
        canvasX: x,
        canvasY: y,
        fontSize: 24
      }
    }));
    setActiveMapping(null);
  };

  const generateSinglePdf = async (recipient: Recipient) => {
    if (!pdfData) return null;
    try {
      const pdfDoc = await PDFDocument.load(pdfData);
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const pages = pdfDoc.getPages();
      const firstPage = pages[0];
      const { width, height } = firstPage.getSize();

      Object.entries(mappings).forEach(([_, mapping]) => {
        const text = String(recipient[mapping.column] || '');
        firstPage.drawText(text, {
          x: mapping.x * width,
          y: mapping.y * height,
          size: mapping.fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      });

      return await pdfDoc.save();
    } catch (err) {
      console.error("PDF Generation error:", err);
      return null;
    }
  };

  const startAutomation = async () => {
    if (excelData.length === 0) return;
    setIsProcessing(true);
    setLogs([]);
    setOverallProgress({ current: 0, total: excelData.length, sent: 0, errors: 0 });

    try {
      setLogs([{ status: 'info', message: 'Starting PDF generation...' }]);
      const recipientsWithPdfs = [];
      
      for (let i = 0; i < excelData.length; i++) {
        const recipient = excelData[i];
        const pdfBytes = await generateSinglePdf(recipient);
        if (pdfBytes) {
          const base64 = btoa(
            new Uint8Array(pdfBytes).reduce((data, byte) => data + String.fromCharCode(byte), '')
          );
          recipientsWithPdfs.push({
            name: String(recipient.name || recipient[headers[0]] || 'Recipient'),
            email: String(recipient.email || recipient.Email || recipient.EMAIL || ''),
            pdfBase64: base64
          });
        }
      }

      setLogs(prev => [...prev, { status: 'info', message: 'PDFs generated. Connecting to SMTP server...' }]);

      const response = await fetch('/api/send-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: recipientsWithPdfs,
          smtpConfig,
          emailTemplate
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Connection failed');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader!.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.status === 'done') {
                setIsProcessing(false);
              }
              if (data.progress) {
                setOverallProgress(data.progress);
              }
              setLogs(prev => [...prev.slice(-49), { status: data.status, message: data.message }]);
            } catch (e) {
              // Handle partial JSON or formatting issues
            }
          }
        }
      }

    } catch (error) {
      setLogs(prev => [...prev, { status: 'error', message: (error as Error).message }]);
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-24">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <CheckCircle2 className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">CertiFlow</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex gap-2 mr-4">
            {[1, 2, 3, 4].map(s => (
              <div 
                key={s}
                className={cn(
                  "w-8 h-1 rounded-full transition-colors",
                  step >= s ? "bg-indigo-600" : "bg-slate-200"
                )}
              />
            ))}
          </div>
          <span className="text-sm font-medium text-slate-500">Step {step} of 4</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 md:p-8">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div 
              key="step1"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-8"
            >
              <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
                <div className="mb-6">
                  <div className="bg-indigo-100 w-12 h-12 rounded-xl flex items-center justify-center mb-4">
                    <FileText className="text-indigo-600 w-6 h-6" />
                  </div>
                  <h2 className="text-2xl font-bold">PDF Template</h2>
                  <p className="text-slate-500 mt-1">Upload the certificate design.</p>
                </div>
                
                <label className="border-2 border-dashed border-slate-200 rounded-xl p-12 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-slate-50 transition-all group">
                  <input type="file" className="hidden" accept=".pdf" onChange={handlePdfUpload} />
                  <FileUp className="w-10 h-10 text-slate-400 group-hover:text-indigo-500 mb-4" />
                  <span className="font-medium text-center">{pdfFile ? pdfFile.name : 'Choose PDF File'}</span>
                  <span className="text-sm text-slate-400 mt-1 text-center">Max file size 10MB</span>
                </label>
              </div>

              <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
                <div className="mb-6">
                  <div className="bg-emerald-100 w-12 h-12 rounded-xl flex items-center justify-center mb-4">
                    <TableIcon className="text-emerald-600 w-6 h-6" />
                  </div>
                  <h2 className="text-2xl font-bold">Recipient List</h2>
                  <p className="text-slate-500 mt-1">Upload Excel (.xlsx) file.</p>
                </div>
                
                <label className="border-2 border-dashed border-slate-200 rounded-xl p-12 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 hover:bg-slate-50 transition-all group">
                  <input type="file" className="hidden" accept=".xlsx" onChange={handleExcelUpload} />
                  <FileUp className="w-10 h-10 text-slate-400 group-hover:text-emerald-500 mb-4" />
                  <span className="font-medium text-center">{excelData.length > 0 ? `${excelData.length} Recipients Loaded` : 'Choose Excel File'}</span>
                  <span className="text-sm text-slate-400 mt-1 text-center">Required column: "email"</span>
                </label>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
              <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl flex gap-3 text-amber-800">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-sm">Select a header and click its position on the certificate.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                <div className="lg:col-span-1 space-y-2">
                  {headers.map(header => (
                    <button
                      key={header}
                      onClick={() => setActiveMapping(header)}
                      className={cn(
                        "w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between",
                        activeMapping === header ? "border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200" : mappings[header] ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
                      )}
                    >
                      <span className="truncate font-medium">{header}</span>
                      {mappings[header] && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                    </button>
                  ))}
                </div>

                <div className="lg:col-span-3 bg-white rounded-2xl border p-4 shadow-sm relative min-h-[500px] flex items-center justify-center overflow-auto">
                   {pdfUrl ? (
                      <div className="relative border shadow-2xl">
                        <embed src={`${pdfUrl}#toolbar=0&navpanes=0`} width="600" height="400" className="pointer-events-none" />
                        <canvas ref={canvasRef} width={600} height={400} onClick={handleCanvasClick} className={cn("absolute inset-0 z-10", activeMapping ? "cursor-crosshair bg-indigo-500/5" : "")} />
                        {Object.entries(mappings).map(([header, m]) => (
                          <div key={header} className="absolute z-20 bg-indigo-600 text-white text-[10px] px-2 py-1 rounded shadow-xl -translate-x-1/2 -translate-y-1/2 flex items-center gap-1 font-bold" style={{ left: m.canvasX, top: m.canvasY }}>
                            {header}
                            <X className="w-3 h-3 cursor-pointer" onClick={(e) => {
                              e.stopPropagation();
                              const newMappings = { ...mappings };
                              delete newMappings[header];
                              setMappings(newMappings);
                            }} />
                          </div>
                        ))}
                      </div>
                    ) : <p className="text-slate-400">PDF not loaded</p>}
                </div>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl mx-auto space-y-6">
              <div className="bg-white p-6 rounded-2xl border space-y-4">
                <h3 className="font-bold flex items-center gap-2"><Mail className="w-5 h-5 text-indigo-600" /> SMTP Config</h3>
                <div className="grid grid-cols-2 gap-4">
                   <input className="px-4 py-2 border rounded-xl" placeholder="SMTP Host" value={smtpConfig.host} onChange={e => setSmtpConfig({...smtpConfig, host: e.target.value})} />
                   <input className="px-4 py-2 border rounded-xl" placeholder="Port" value={smtpConfig.port} onChange={e => setSmtpConfig({...smtpConfig, port: e.target.value})} />
                   <input className="px-4 py-2 border rounded-xl transition-all outline-indigo-500" placeholder="Username (Email)" value={smtpConfig.user} onChange={e => setSmtpConfig({...smtpConfig, user: e.target.value})} />
                   <input className="px-4 py-2 border rounded-xl transition-all outline-indigo-500" type="password" placeholder="Password" value={smtpConfig.pass} onChange={e => setSmtpConfig({...smtpConfig, pass: e.target.value})} />
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl border space-y-4">
                <h3 className="font-bold">Email Content</h3>
                <input className="w-full px-4 py-2 border rounded-xl" placeholder="Subject" value={emailTemplate.subject} onChange={e => setEmailTemplate({...emailTemplate, subject: e.target.value})} />
                <textarea className="w-full h-32 px-4 py-2 border rounded-xl resize-none" placeholder="Message body..." value={emailTemplate.body} onChange={e => setEmailTemplate({...emailTemplate, body: e.target.value})} />
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div key="step4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto space-y-6">
              {!overallProgress ? (
                <div className="text-center py-12 bg-white rounded-3xl border">
                  <Send className="w-16 h-16 text-indigo-600 mx-auto mb-4" />
                  <h2 className="text-2xl font-bold">Ready to Start?</h2>
                  <p className="text-slate-500 mb-8 px-4">This will generate {excelData.length} certificates and email them with random intervals.</p>
                  <button onClick={startAutomation} className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-all scale-110">Start Automation</button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-white p-4 rounded-xl border text-center">
                       <p className="text-xs font-bold text-slate-400">TOTAL</p>
                       <p className="text-2xl font-bold">{overallProgress.total}</p>
                    </div>
                    <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 text-center">
                       <p className="text-xs font-bold text-emerald-600">SENT</p>
                       <p className="text-2xl font-bold">{overallProgress.sent}</p>
                    </div>
                    <div className="bg-red-50 p-4 rounded-xl border border-red-100 text-center">
                       <p className="text-xs font-bold text-red-600">FAILED</p>
                       <p className="text-2xl font-bold">{overallProgress.errors}</p>
                    </div>
                  </div>

                  <div className="bg-slate-900 rounded-xl p-6 h-96 overflow-y-auto font-mono text-xs text-emerald-400 space-y-1">
                    {logs.map((log, i) => (
                      <div key={i} className={log.status === 'error' ? 'text-red-400' : log.status === 'info' ? 'text-indigo-400' : ''}>
                        {`> [${log.status.toUpperCase()}] ${log.message}`}
                      </div>
                    ))}
                    {isProcessing && <div className="animate-pulse">_</div>}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 flex justify-between px-8 z-50 shadow-2xl">
        <button onClick={() => setStep(step - 1)} disabled={step === 1 || isProcessing} className="px-6 py-2 rounded-xl border hover:bg-slate-50 transition-all font-bold disabled:opacity-30">Back</button>
        {step < 4 ? <button onClick={() => setStep(step + 1)} disabled={step === 1 && (!pdfData || excelData.length === 0)} className="bg-indigo-600 text-white px-8 py-2 rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50">Next</button> : null}
      </footer>
    </div>
  );
}
