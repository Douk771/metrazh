// Локальное хранилище: всё лежит в IndexedDB на устройстве, никуда не отправляется.
const DB_NAME = 'metrazh';
const DB_VERSION = 2;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('photos')) {
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('projectId', 'projectId');
      }
      // Настройки риелтора (логотип, подпись) — общие для всех объектов.
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(stores, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const result = fn(Array.isArray(stores) ? stores.map((s) => t.objectStore(s)) : t.objectStore(stores));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function newProject(name = 'Новый объект') {
  const now = Date.now();
  return {
    id: uid(),
    name,
    address: '',
    createdAt: now,
    updatedAt: now,
    plan: { wallCm: 12, rooms: [] },
  };
}

// ---------- объекты ----------
export async function listProjects() {
  const all = await tx('projects', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id) {
  return tx('projects', 'readonly', (s) => s.get(id));
}

export function saveProject(project) {
  project.updatedAt = Date.now();
  return tx('projects', 'readwrite', (s) => s.put(project));
}

export function deleteProject(id) {
  return tx(['projects', 'photos'], 'readwrite', ([projects, photos]) => {
    projects.delete(id);
    const req = photos.index('projectId').openKeyCursor(IDBKeyRange.only(id));
    req.onsuccess = () => {
      const c = req.result;
      if (c) { photos.delete(c.primaryKey); c.continue(); }
    };
  });
}

// ---------- фото ----------
// { id, projectId, order, name, blob (до 2560 px), thumb (до 480 px), w, h, createdAt }
export async function listPhotos(projectId) {
  const all = await tx('photos', 'readonly', (s) => s.index('projectId').getAll(projectId));
  return all.sort((a, b) => a.order - b.order);
}

export function putPhoto(photo) {
  return tx('photos', 'readwrite', (s) => s.put(photo));
}

export function putPhotos(photos) {
  return tx('photos', 'readwrite', (s) => { photos.forEach((p) => s.put(p)); });
}

export function deletePhoto(id) {
  return tx('photos', 'readwrite', (s) => s.delete(id));
}

export async function countPhotos(projectId) {
  return tx('photos', 'readonly', (s) => s.index('projectId').count(projectId));
}

// ---------- настройки ----------
export async function getSetting(key, fallback) {
  const row = await tx('settings', 'readonly', (s) => s.get(key));
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  return tx('settings', 'readwrite', (s) => s.put({ key, value }));
}

// ---------- надёжность хранения ----------
// Просим браузер не вычищать данные (особенно важно для Safari на iOS).
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function isPersisted() {
  return navigator.storage?.persisted ? navigator.storage.persisted() : false;
}

// ---------- резервная копия объекта одним файлом (план + фото) ----------
const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
const dataUrlToBlob = (url) => fetch(url).then((r) => r.blob());

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const safeName = (s) => (s || 'объект').replace(/[\\/:*?"<>|]+/g, '_').trim();

export async function exportProject(project) {
  const photos = await listPhotos(project.id);
  const packed = await Promise.all(photos.map(async (p) => ({
    ...p, blob: await blobToDataUrl(p.blob), thumb: await blobToDataUrl(p.thumb),
  })));
  const payload = { format: 'metrazh-project', version: 2, project, photos: packed };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  downloadBlob(blob, `${safeName(project.name)}.metrazh.json`);
}

export async function importProject(file) {
  const data = JSON.parse(await file.text());
  const p = data?.project;
  if (data?.format !== 'metrazh-project' || !p || !Array.isArray(p.plan?.rooms)) {
    throw new Error('Это не файл объекта Метража');
  }
  // Новый id, чтобы импорт никогда не затирал существующий объект.
  const project = { ...newProject(p.name), ...p, id: uid() };
  await saveProject(project);
  if (Array.isArray(data.photos) && data.photos.length) {
    const photos = await Promise.all(data.photos.map(async (ph) => ({
      ...ph, id: uid(), projectId: project.id,
      blob: await dataUrlToBlob(ph.blob), thumb: await dataUrlToBlob(ph.thumb),
    })));
    await putPhotos(photos);
  }
  return project;
}
