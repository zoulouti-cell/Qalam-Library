# Qalam Smart — local, PDF-independent runtime

Standalone Node 24.2+ app, no npm runtime dependencies. New UI in public/.
All APIs same origin. No PDF/image-source endpoint or dependency.

## JSON API

- GET /api/stats: {documents,texts,summaries,catalogOnly,categories,dbBytes,pdfFree:true,version,quality:{needsReview,automatedReview},buildDate}
- GET /api/categories: {categories:[{name,count,group,groupLabel,tier}]}, ordered by the original library's sections and materials. Groups: materials, authorities, councils, judicial, studies, org.
- GET /api/search?q=&type=all|national|judicial|juriscassation&category=&quality=all|text|summary|catalog&from=&to=&page=1&limit=20: {query,total,page,limit,results:[Result],suggestions:[string],relaxed:boolean,elapsedMs}
- GET /api/suggest?q=: {suggestions:[{text,type:'title'|'term'|'related',id?}]}
- GET /api/document?id=: Document
- POST /api/ask JSON {question,history:[{role,content}],documentId?}: immediate {mode:'extractive',answer,sources:[{id,title,excerpt,label?,textKind,reviewStatus}],limitations:[string],citationsVerified:boolean,analysisPending?:boolean,jobId?:string}. Literal article requests skip generation. Other eligible requests can receive a background analysis job; the initial sources stay visible.
- GET /api/answer?id=: {status:'running'} or {status:'complete',result:{mode,answer,sources,limitations,citationsVerified}}. Local ephemeral jobs expire after five minutes. OCR temporarily drains active pages during model generation and resumes automatically; the lease expires if the app stops.
- GET /api/capabilities: {pdfFree:true,ai:{available:boolean,mode,model},speech:{piperAvailable:boolean,sttAvailable:boolean,sttEngine:string}}
- POST /api/tts JSON {text}: audio/wav or JSON error with non-200 status; browser speechSynthesis is the default lightweight fallback.
- POST /api/stt audio/wav (16kHz mono PCM16): {text,engine,warnings?:[string]}; optional local service, use browser recognition when unavailable and disclose browser service/network possibility.
- GET /api/health: {ok:true,pdfFree:true,...}

### User contributions (signed-in individual accounts; admin routes require the admin role)

- GET /api/contributions/config: {canSubmit,reason,kinds:[{id:'law'|'jurisprudence'|'research'|'study',label,hint}],noteTypes,limits:{originalBytes,originalsPerItem,...},mailNotices}
- POST /api/contributions/file (body = raw bytes, header x-file-name=encodeURIComponent(name)): 201 {id:'f_<20 hex>',name,ext:'pdf'|'png'|'jpg'|'webp'|'docx'|'txt',size}. Magic-byte sniffed; executables/HTML rejected (415); stored temporarily in MongoDB (TTL 24 h while unattached). GET /api/contributions/file?id= returns the caller's own file only. POST /api/contributions/file/delete {id}.
- POST /api/contributions/extract (docx/txt bytes): {text}. PDF and images are read in the browser (pdf.js text layer, Tesseract ara+fra); no Gemini.
- POST /api/contributions/addition {kind,title,issuedAt,source,sourceUrl?,issuer?,reference?,note?,text,fileIds:[≥1 owned unattached originals]}: 201 {id,status:'pending'}. Duplicate text → 409; quotas → 429.
- POST /api/contributions/note {documentId,noteType:'error'|'missing'|'suggestion'|'other',message,excerpt?}: 201 {id,status:'pending'}.
- GET /api/contributions/mine → {items:[{id,type,kind,kindLabel,title,issuedAt,status,statusLabel,reply,originals,unread,publishedDocumentId?,createdAt}]}; GET /api/contributions/unread → {unread}; POST /api/contributions/seen.
- Statuses: pending «قيد الدرس» → reviewing (draft exists) → published | declined (additions); pending → accepted | declined (notes). Each change notifies the user in-app and by email (Brevo, when configured).
- Admin: GET /api/admin/contributions?type=&status=&q=&page= → {items,total,page,pages,counts:{additions:{status:n},notes:{status:n}},statuses}; GET /api/admin/contributions/item?id= (full record incl. text and originalFiles); GET /api/admin/contributions/file?id=[&mode=download]; POST /api/admin/contributions/draft {id} → {documentId} (creates a managed draft with origin:'contribution', carrying issuer and originalFiles); POST /api/admin/contributions/resolve {id,status:'declined'|'accepted',reply} (decline requires a reply and purges the originals).
- POST /api/admin/content/publish {documentId,confirmReviewed:true,driveSubfolder?} → {ok,documentId,status:'published',originals:{total,moved,failed,folder,error}}. Publishing moves pending originals to Drive (section folder, or a titled subfolder inside it) and deletes them from MongoDB; a Drive failure never blocks publication.
- GET /api/admin/originals/drive → {ready,mode,via:'user'|'service',account,reauthorize?,root,sharedDrive,error,note,connectable,connection:{email,connectedAt}|null}; GET /api/admin/drive/connect (302 to Google consent: scope `openid email https://www.googleapis.com/auth/drive`, access_type=offline, prompt=consent; admin only; returns via the shared /api/auth/google/callback with a signed flow cookie flagged purpose=drive, then redirects to /admin?drive=connected|cancelled|scope|norefresh|folder|denied|unavailable|failed); POST /api/admin/drive/disconnect → {ok,connected:false,revoked} (revokes the refresh token at Google and unsets it; the token is stored only sealed in librarySettings.driveWrite). While linked, all Drive writes use the linked account's token; otherwise the service account is tried; GET /api/admin/originals/section?kind=&type=&category=&title=&issuer= → {id,label,court}; POST /api/admin/originals/transfer {documentId,driveSubfolder?} retries a failed move for a published document.
- GET /api/original?doc=&file=[&mode=download]: public (reader) access to an original still held on the server for a published document; once moved, originals are served through /api/drive/file?id=<driveId>. Document.originalFiles: [{id,name,ext,size,driveId?}].

Result: {id,title,type,category,subcategory,date,textKind:'extracted_text'|'source_summary'|'image_only',reviewStatus,issues:[string],snippet,score,lawNumber,decisionNumber,abrogated}
Document: all Result fields + {text,headings:[{key,label,number,marker,start,end}],citation,sourceLabel,caseNumber,chars,sha256,sourceTextSha256,originalTitle,sourceUrl,presentation,readingAssessment}
text is the continuous reading presentation. start/end are JS UTF-16 positions into this text. sha256 hashes the reading text; sourceTextSha256 hashes the preserved compressed source transcription. Presentation removes layout breaks and evidenced pagination without inventing missing wording.

## Product constraints

- Arabic RTL, Moroccan legal identity, deep green/ivory/muted gold, modern editorial workspace, responsive/accessibility.
- Texts are never all described as human verified. Summary != full ruling. OCR drafts are explicitly labeled and blocked from generated legal analysis until reviewed. Live counts come from /api/stats.
- Runtime dataset: 41,847 cards after excluding 52 annual finance/settlement acts. Short judicial decision/jurisprudence cards remain available without a local original or full text; 11,766 such cards were restored. They stay source_summary/image_only, never invented full decisions. OCR adds complete draft texts incrementally. Source archive is separate from runtime.
- Instant debounced search with abort, accurate paging, filter before limit, suggestions, keyboard shortcut.
- Reader always displays available text; outline, in-document search, font size, copy citation, text export, bookmarks/notes/history saved only on this device.
- Assistant panel grounded in actual sources, no invented judgments/citations. Extractive mode must be clearly labeled when no model is connected.
- Optional personalization local-only, explicit toggle; no remote analytics or hidden collection.
- Voice capabilities must show actual availability; no fake transcription, microphone requires user click, stop releases audio stream.
- Do not expose filesystem paths, implementation clutter, or secrets in product UI.

## Multi-platform direction

Qalam should grow as one legal-information service with several clients, not as separate web/mobile/desktop products that duplicate search and editorial rules.

- Keep the legal catalog, search ranking, citation formatting, text quality labels, and assistant grounding in a shared domain/API layer. Web, phone, and desktop clients consume JSON contracts and must not reimplement those rules independently.
- The current server is a local-first single-user runtime bound to loopback. The editorial correction endpoints are intentionally loopback-only and write directly to SQLite. Do not expose this runtime or these write routes to the public internet as-is.
- Before a hosted platform or multi-user sync, introduce a versioned public API (`/api/v1`), authentication/authorization, per-user audit trails, rate limits, backups, and a server-side repository boundary. Keep local SQLite as an offline/read-only cache or portable edition; do not make clients write to a shared SQLite file.
- Preserve offline access for the phone and desktop editions: versioned text/index packages, incremental sync by generation, explicit conflict handling, and a visible data freshness date. Legal source updates must be attributable and reversible.
- Build the website first as the reference responsive client. A PWA can provide installability and cached shell; native phone/desktop clients can follow against the same API. Share design tokens, accessibility behavior, and API schemas rather than forcing one UI implementation across all platforms.
- Keep large OCR, speech, and model assets optional and separately downloadable so the base library stays small. Local-only operation and the no-PDF runtime remain supported.

## Database contract (primary owns builder/schema)

data/library.sqlite:
documents(rowid INTEGER PRIMARY KEY,id TEXT UNIQUE,type,title,title_norm,category,subcategory,date,kind,law_number,decision_number,case_number,text_kind,review_status,issues TEXT JSON,chars INTEGER,body BLOB Brotli UTF8,sha256,abrogated INTEGER,source_label)
search FTS5(title,body,content='',tokenize='unicode61 remove_diacritics 2'), rowid = documents.rowid; title/body use normalized Arabic/French, original text is preserved in body.
headings(id INTEGER PRIMARY KEY,doc_rowid INTEGER,marker,label,number TEXT,start INTEGER,end INTEGER)
terms(term TEXT PRIMARY KEY,count INTEGER) — title vocabulary.
metadata(key TEXT PRIMARY KEY,value TEXT JSON).
catalog_order(doc_rowid INTEGER PRIMARY KEY,position INTEGER) preserves original browsing priorities within instrument ranks. Both browsing and search order active laws, independent dahirs, decrees, other documents, then repealed texts; relevance applies within each rank. law_titles preserves original headings and number evidence.

normalizeSearch: NFKC; remove Arabic diacritics/tatweel; map alef variants to ا, ى/ی to ي, ک to ك; Arabic/extended digits to ASCII; lowercase. Never swap all ال to لا.
