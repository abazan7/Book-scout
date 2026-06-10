const video = document.querySelector("#video");
const cameraState = document.querySelector("#cameraState");
const startScan = document.querySelector("#startScan");
const stopScan = document.querySelector("#stopScan");
const lookupForm = document.querySelector("#lookupForm");
const codeInput = document.querySelector("#codeInput");
const apiStatus = document.querySelector("#apiStatus");
const bookCard = document.querySelector("#bookCard");
const bookCover = document.querySelector("#bookCover");
const bookTitle = document.querySelector("#bookTitle");
const bookAuthor = document.querySelector("#bookAuthor");
const resultTitle = document.querySelector("#resultTitle");
const sourceBadge = document.querySelector("#sourceBadge");
const notice = document.querySelector("#notice");
const examplesList = document.querySelector("#examplesList");
const keepBookButton = document.querySelector("#keepBook");
const skipBookButton = document.querySelector("#skipBook");
const exportCsvButton = document.querySelector("#exportCsv");
const keptList = document.querySelector("#keptList");

let stream = null;
let detector = null;
let scanTimer = null;
let zxingControls = null;
let lastCode = "";
let currentBook = null;
let keptBooks = JSON.parse(localStorage.getItem("keptBooks") || "[]");

const fields = {
  used: {
    rate: document.querySelector("#usedRate"),
    active: document.querySelector("#usedActive"),
    sold: document.querySelector("#usedSold"),
    average: document.querySelector("#usedAverage"),
    range: document.querySelector("#usedRange"),
  },
  new: {
    rate: document.querySelector("#newRate"),
    active: document.querySelector("#newActive"),
    sold: document.querySelector("#newSold"),
    average: document.querySelector("#newAverage"),
    range: document.querySelector("#newRange"),
  },
};

function money(value, currency = "USD") {
  if (value === null || value === undefined) return "--";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

function percent(value) {
  if (value === null || value === undefined) return "--";
  return `${Math.round(value * 100)}%`;
}

function count(value) {
  if (value === null || value === undefined) return "--";
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const config = await response.json();
  apiStatus.textContent = config.hasCredentials
    ? `Connected for ${config.marketplaceId}`
    : "Demo mode until eBay API keys are added";
}

async function lookup(code) {
  const normalized = String(code).replace(/\D/g, "");
  if (!normalized) return;

  resultTitle.textContent = `Looking up ${normalized}...`;
  sourceBadge.textContent = "Loading";
  notice.hidden = true;
  keepBookButton.disabled = true;
  skipBookButton.disabled = true;
  currentBook = null;

  try {
    const [book, market] = await Promise.all([lookupBookDetails(normalized), lookupMarket(normalized)]);
    renderBook(book);
    renderMarket(market);
    currentBook = { ...book, market };
    keepBookButton.disabled = false;
    skipBookButton.disabled = false;
  } catch (error) {
    resultTitle.textContent = "Lookup failed";
    sourceBadge.textContent = "Error";
    notice.hidden = false;
    notice.textContent = error.message || "Search error. Try again.";
  }
}

async function lookupMarket(code) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.hint ? `${data.error} ${data.hint}` : data.error);
  }
  return data;
}

async function lookupBookDetails(isbn) {
  try {
    const googleResponse = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    const googleData = await googleResponse.json();
    if (googleData.totalItems > 0) {
      const book = googleData.items[0].volumeInfo;
      return {
        isbn,
        title: book.title || "No title found",
        author: book.authors?.join(", ") || "Unknown author",
        source: "Google Books",
        cover: book.imageLinks?.thumbnail || `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
      };
    }
  } catch {}

  try {
    const openResponse = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
    if (openResponse.ok) {
      const openData = await openResponse.json();
      return {
        isbn,
        title: openData.title || "No title found",
        author: "Unknown author",
        source: "Open Library",
        cover: `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
      };
    }
  } catch {}

  return {
    isbn,
    title: "Book details not found",
    author: "Unknown author",
    source: "ISBN",
    cover: `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
  };
}

function renderBook(book) {
  bookTitle.textContent = book.title;
  bookAuthor.textContent = `${book.author} · ${book.isbn} · ${book.source}`;
  bookCover.src = book.cover;
  bookCover.hidden = false;
  bookCard.hidden = false;
}

function renderMarket(data) {
  resultTitle.textContent = `Market stats for ${data.gtin}`;
  sourceBadge.textContent = data.source === "live" ? "Live eBay" : "Demo data";
  notice.hidden = !data.notice;
  notice.textContent = data.notice || "";

  for (const key of ["used", "new"]) {
    const row = data.results[key];
    fields[key].rate.textContent = percent(row.sellThroughRate);
    fields[key].active.textContent = count(row.activeCount);
    fields[key].sold.textContent = row.soldAccess === "pending" ? "Pending access" : count(row.soldCount);
    fields[key].average.textContent = money(row.averagePrice, row.currency);
    fields[key].range.textContent =
      row.minPrice === null || row.maxPrice === null
        ? "--"
        : `${money(row.minPrice, row.currency)} - ${money(row.maxPrice, row.currency)}`;
  }

  const examples = [...(data.results.used.examples || []), ...(data.results.new.examples || [])].slice(0, 6);
  examplesList.innerHTML = "";
  if (!examples.length) {
    const item = document.createElement("li");
    item.textContent =
      data.source === "demo" ? "Live sold examples appear after eBay credentials are configured." : "No examples returned.";
    examplesList.append(item);
    return;
  }

  for (const example of examples) {
    const item = document.createElement("li");
    const price = example.price ? ` ${money(example.price)}` : "";
    if (example.url) {
      const link = document.createElement("a");
      link.href = example.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = `${example.title}${price}`;
      item.append(link);
    } else {
      item.textContent = `${example.title}${price}`;
    }
    examplesList.append(item);
  }
}

async function startCamera() {
  stopCamera();
  lastCode = "";

  if (!navigator.mediaDevices?.getUserMedia) {
    cameraState.textContent = "Camera scanning is not available in this browser. Manual entry still works.";
    return;
  }

  if ("BarcodeDetector" in window) {
    await startNativeScanner();
    return;
  }

  if (window.ZXingBrowser?.BrowserMultiFormatReader) {
    await startZxingScanner();
    return;
  }

  cameraState.textContent = "Scanner library did not load. Check your connection or use manual entry.";
}

async function startNativeScanner() {
  detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  cameraState.textContent = "Point the ISBN barcode at the scan line";
  scanTimer = window.setInterval(scanFrame, 350);
}

async function startZxingScanner() {
  const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
  cameraState.textContent = "Starting iPhone scanner...";
  zxingControls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
    const code = result?.getText?.().replace(/\D/g, "");
    if (!code || code === lastCode) return;
    lastCode = code;
    codeInput.value = code;
    cameraState.textContent = `Found ${code}`;
    stopCamera();
    lookup(code);
  });
  cameraState.textContent = "Point the ISBN barcode at the scan line";
}

async function scanFrame() {
  if (!detector || !video.srcObject) return;
  try {
    const codes = await detector.detect(video);
    const code = codes[0]?.rawValue?.replace(/\D/g, "");
    if (code && code !== lastCode) {
      lastCode = code;
      codeInput.value = code;
      cameraState.textContent = `Found ${code}`;
      stopCamera();
      await lookup(code);
    }
  } catch {
    cameraState.textContent = "Scanner paused. Try manual entry if the camera is blurry.";
  }
}

function stopCamera() {
  if (scanTimer) window.clearInterval(scanTimer);
  scanTimer = null;
  if (zxingControls) zxingControls.stop();
  zxingControls = null;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  const activeStream = video.srcObject;
  if (activeStream?.getTracks) activeStream.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
  cameraState.textContent = "Camera idle";
}

function keepCurrentBook() {
  if (!currentBook) return;
  const used = currentBook.market.results.used;
  const next = {
    isbn: currentBook.isbn,
    title: currentBook.title,
    author: currentBook.author,
    usedActive: used.activeCount,
    usedSold: used.soldCount,
    usedSellThrough: percent(used.sellThroughRate),
    usedAverage: money(used.averagePrice, used.currency),
    date: new Date().toLocaleString(),
  };
  keptBooks.unshift(next);
  localStorage.setItem("keptBooks", JSON.stringify(keptBooks));
  renderKeptBooks();
  resultTitle.textContent = "Saved to kept books";
  codeInput.value = "";
}

function skipCurrentBook() {
  currentBook = null;
  keepBookButton.disabled = true;
  skipBookButton.disabled = true;
  resultTitle.textContent = "Skipped";
  codeInput.value = "";
}

function renderKeptBooks() {
  keptList.innerHTML = "";
  if (!keptBooks.length) {
    const item = document.createElement("li");
    item.textContent = "No kept books yet.";
    keptList.append(item);
    return;
  }

  for (const book of keptBooks.slice(0, 20)) {
    const item = document.createElement("li");
    item.innerHTML = `<strong>${book.title}</strong><br>${book.isbn} · Used STR ${book.usedSellThrough} · Avg ${book.usedAverage}`;
    keptList.append(item);
  }
}

function exportCSV() {
  if (!keptBooks.length) {
    alert("No kept books to export.");
    return;
  }

  const rows = [
    ["ISBN", "Title", "Author", "Used Active", "Used Sold", "Used STR", "Used Avg", "Date"],
    ...keptBooks.map((book) => [
      book.isbn,
      book.title,
      book.author,
      book.usedActive,
      book.usedSold,
      book.usedSellThrough,
      book.usedAverage,
      book.date,
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "book-scout-kept-books.csv";
  link.click();
  URL.revokeObjectURL(url);
}

startScan.addEventListener("click", () => {
  startCamera().catch((error) => {
    cameraState.textContent = error.message.includes("Permission")
      ? "Camera permission is needed to scan barcodes."
      : "Could not start the camera. Manual entry still works.";
  });
});

stopScan.addEventListener("click", stopCamera);
keepBookButton.addEventListener("click", keepCurrentBook);
skipBookButton.addEventListener("click", skipCurrentBook);
exportCsvButton.addEventListener("click", exportCSV);

lookupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  lookup(codeInput.value);
});

loadConfig().catch(() => {
  apiStatus.textContent = "Demo mode";
});
renderKeptBooks();
