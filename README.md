# Tidrapport & utlägg – administratörsguide

En webbapp för att registrera arbetstid, resor (med milersättning), utlägg med kvitton och frånvaro. Den anställda skickar tidrapporten till sin chef för attest, utläggen och milersättningen till lönekontoret och kvittona separat till kvittoredovisningen, via sitt eget mejlprogram.

* Ingen server, inga konton, ingen databas att sköta. Appen är bara statiska filer.
* Varje anställd fyller i namn och chefens e-post **en gång**. Allt sparas lokalt på den egna enheten.
* Appen fungerar offline och kan läggas till på hemskärmen (iPhone, Android, Windows, Mac).

## 1. Publicera appen (en gång)

Appen måste ligga på en **https-adress** för att kunna installeras och fungera offline.

**Alternativ A – GitHub Pages**
1. Skapa ett nytt repo på GitHub, t.ex. `tidrapport`. På GitHubs gratisnivå måste repot vara publikt för Pages. Det går bra, eftersom koden inte innehåller några personuppgifter, men lönekontorets e-postadresser i `config.json` blir synliga.
2. Ladda upp **alla filer och mappar i den här mappen** till repots rot.
3. Gå till *Settings → Pages*, välj *Deploy from a branch*, gren `main` och mapp `/ (root)`.
4. Efter någon minut finns appen på `https://<konto>.github.io/tidrapport/`.

**Alternativ B – Netlify Drop (inget Git-konto behövs)**
1. Gå till app.netlify.com/drop och dra in hela mappen.
2. Du får en adress direkt. Filen `_headers` ger då extra säkerhetshuvuden automatiskt.

Fungerar också: företagets egen webbserver, Azure Static Web Apps, Cloudflare Pages.

## 2. Ställ in företagets uppgifter – `config.json`

```json
{
  "foretag": "Cubsec AB",
  "lonekontor": "lon@foretaget.se",
  "kvittoredovisning": "kvitton@foretaget.se",
  "milersattning": { "egenBil": 25, "formansbil": 12, "formansbilEl": 9.5 }
}
```

* **lonekontor**: mottagare för *Skicka utlägg Lönekontor*. (Den äldre nyckeln `lonekontorTidrapport` läses fortfarande.)
* **kvittoredovisning**: mottagare för *Skicka kvittoredovisning*. (Den äldre nyckeln `lonekontorLonefragor` läses fortfarande, så en gammal `config.json` fungerar.)
* När en adress är ifylld här behöver användarna inte ange den och kan inte ändra den. En tom adress fyller varje användare i själv.
* **milersattning**: kronor per mil. Förvalt är Skatteverkets skattefria nivåer för 2026.
* Ändringar i `config.json` slår igenom nästa gång användaren öppnar appen med internetuppkoppling.

## 3. Dela med de anställda

Skicka länken via mejl, Teams eller intranätet, t.ex.:

> Öppna länken i mobilen. iPhone: tryck Dela → *Lägg till på hemskärmen*. Android: menyn → *Installera app*. Fyll i ditt namn och din chefs e-post första gången.

## 4. Så skickas tidrapport och kvittoredovisning

Det finns tre knappar. Inga kvitton följer med de två första.

| Knapp | Mottagare | Innehåll | Bilagor |
|---|---|---|---|
| **Skicka tidrapport chef** | Attesterande chef | Arbete, resor (restid, körjournal, milersättning), frånvaro och utlägg betalda med privat kort/kontant (ersätts) | Excel-mallen ifylld + PDF |
| **Skicka utlägg Lönekontor** | Lönekontorets adress | Utlägg betalda med privat kort/kontant och milersättning, alltså det som ska betalas ut. Inga timmar och ingen frånvaro. | PDF + Excel-lista för lönesystemet |
| **Skicka kvittoredovisning** | Kvittoredovisningens adress | Alla utlägg i vald period, även företagskort, med kvittona som bilagor | En samlad PDF |

Utlägg betalda med **företagskort** syns bara i kvittoredovisningen, eftersom de inte ska ersättas.

**Kvittoredovisningen** (*Skicka kvittoredovisning*) skickas separat till kvittoredovisningsadressen. Användaren väljer en period (från och med – till och med, förvalt hela den visade månaden), och alla utlägg med **kvittodatum** inom perioden samlas i **en PDF**: först en sammanställning (datum, beskrivning, kategori, betalsätt, moms, belopp, utan kvitto markerade), sedan varje kvitto som bilaga. Både fotograferade kvitton och kvitton som laddats upp som PDF läggs in i samma fil. En PDF som inte går att läsa in, t.ex. en lösenordsskyddad, bifogas som egen fil och markeras ”separat fil”. Appen visar hur många utlägg i perioden som redan har redovisats tidigare.

Användaren väljer sedan ett av tre sätt att skicka:

| Sätt | Passar | Vad händer |
|---|---|---|
| **Dela med bilagor** | Mobil | Telefonens delningsmeny öppnas med bilagorna. Välj Mail, Outlook eller Gmail. Mottagaren kan kopieras med knappen *Kopiera*. |
| **Skapa mejlutkast med bilagor (Outlook)** | Dator med Outlook | En `.eml`-fil sparas. När den öppnas visas ett färdigt mejl med mottagare, ämne, text och bilagor. Tryck Skicka. |
| **Öppna e-post och bifoga själv** | Allt annat (t.ex. Gmail i webbläsaren) | Mejlet öppnas med mottagare, ämne och text ifyllda. Filerna sparas och bifogas manuellt. |

Appen kan inte veta om mejlet faktiskt skickades. Den markerar därför månaden som *Skickad* när användaren väljer ett av sätten, och varnar om något ändras efteråt.

## 5. Uppdatera appen

Byt ut filerna och höj `VERSION` i `sw.js` (t.ex. `tidrapport-v1.2.1`). Användarna får den nya versionen inom ett par öppningar med uppkoppling. Ändras bara `config.json` behövs ingen versionshöjning.

Byter ni Excel-mall: ersätt `tidrapport-mall.xlsx` och behåll samma kolumnlayout (C–H, rad 10–40 för dag 1–31), annars behöver koden justeras.

## 6. Dataskydd

* Uppgifterna (även frånvaro som sjukdom, som är hälsodata enligt GDPR) lagras **bara i användarens webbläsare på den egna enheten** och lämnar den bara när användaren själv skickar ett mejl eller sparar en fil.
* Appen gör inga anrop till andra webbplatser och använder inga typsnitt, analysverktyg eller CDN:er utifrån.
* Lagringen skyddas av enhetens skärmlås och diskkryptering. Påminn medarbetarna om att använda skärmlås.
* Data finns per enhet. Den som vill flytta registreringar mellan mobil och dator använder *Inställningar → Säkerhetskopia*.
* *Inställningar → Radera all data* tar bort allt från enheten, t.ex. när någon slutar.
* Tidrapporterna hamnar sedan i mejlkorgar. Gallring och lagring av dem följer era vanliga rutiner för löneunderlag.

## 7. Säkerhetsgranskning (version 1.2.0)

Det här har gåtts igenom och åtgärdats:

* **Innehållspolicy (CSP)**: bara egna filer får laddas. Inga inline-skript eller inline-stilar. `object`, `base` och `form-action` är blockerade. `_headers` lägger dessutom till `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff` och `Referrer-Policy` där värden stöder det.
* **XSS**: all text från användare och säkerhetskopior skrivs med `textContent`. Ingen `innerHTML` eller `eval` i appens kod. Testat med skript- och bildtaggar som beskrivning.
* **Excel-formelinjektion**: text skrivs som textceller, så `=HYPERLINK(...)` och liknande blir vanlig text.
* **Mejlhuvudinjektion**: e-postadresser valideras strikt, radbrytningar och kontrolltecken tas bort, ämnen kodas enligt RFC 2047 och bilagenamn begränsas till A–Z, 0–9, `.`, `_`, `-`.
* **Import av säkerhetskopia**: varje fält valideras mot vitlistor och intervall. Kvitton kontrolleras med filsignatur (JPEG/PDF) och storleksgräns. Ogiltiga poster hoppas över.
* **Kvitton**: bilder kodas om till JPEG i appen, vilket tar bort EXIF-data som plats. PDF:er kontrolleras med filsignatur och får vara högst 10 MB.
* **Beroenden**: jsPDF uppdaterad till 4.2.1, som täpper till kända sårbarheter i 2.x/3.x (bl.a. CVE-2025-29907 och CVE-2025-57810), JSZip 3.10.2 och pdf-lib 1.17.1 (för att lägga in PDF-kvitton i kvittoredovisningen). Alla ligger lokalt i `vendor/`. `npm audit`: 0 sårbarheter. pdf-lib har inte fått nya versioner sedan 2021 men har inga kända sårbarheter. Den läser bara PDF:er som användaren själv valt (högst 10 MB), och misslyckad inläsning leder till att filen bifogas separat.
* **Uppdelning av uppgifter**: kvittobilder och kvitto-PDF:er följer bara med kvittoredovisningen. Lönekontoret får bara det som ska betalas ut (inga timmar eller frånvaroorsaker), och chefen får inte företagskortsutlägg.
* **Excel-listan till lönekontoret** byggs med textceller och XML-escaping, så att text inte kan tolkas som formler eller bryta filen.
* **Service worker**: hanterar bara GET-anrop till samma webbplats.

Kvarstående att känna till: lokal data är inte krypterad av appen själv utan skyddas av enhetens lås. Den som har tillgång till en olåst enhet kan läsa registreringarna.

## Filer

| Fil | Innehåll |
|---|---|
| `index.html`, `styles.css`, `app.js` | Själva appen |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline och installation |
| `config.json` | Företagets inställningar (redigeras av administratören) |
| `tidrapport-mall.xlsx` | Lönekontorets Excel-mall |
| `vendor/` | JSZip, jsPDF och pdf-lib med licenser |
| `_headers` | Säkerhetshuvuden (Netlify/Cloudflare Pages) |
