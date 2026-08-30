import type { Project, ProjectDetail, Overlay, ImageOverlay, BrollClip } from "../types";

const BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "https://maxfly-api.onrender.com" : "");

let authToken: string | null = null;
export function setAuthToken(t: string | null) { authToken = t; }

function afetch(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  return fetch(input, { ...init, headers });
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  mediaUrl: (key: string) => `${BASE}${key}`,

  async billingMe() {
    return j<{ plan: string; label: string; minutes_cap: number; minutes_used: number;
      minutes_left: number; max_res: number; storage_gb: number; provider: string }>(
      await afetch(`${BASE}/api/billing/me`));
  },

  async billingPlans() {
    return j<{ plans: { id: string; label: string; minutes: number; storage_gb: number;
      max_res: number; price_inr: number }[] }>(await afetch(`${BASE}/api/billing/plans`));
  },

  async billingCheckout(plan: string) {
    return j<any>(await afetch(`${BASE}/api/billing/checkout`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    }));
  },

  async captionStyles() {
    return j<{ styles: { id: string; label: string; animated: boolean }[] }>(
      await afetch(`${BASE}/api/caption-styles`));
  },

  async health() {
    return j<any>(await afetch(`${BASE}/api/health`));
  },

  async listProjects() {
    return j<Project[]>(await afetch(`${BASE}/api/projects`));
  },

  async renameProject(id: string, name: string) {
    return j<Project>(await afetch(`${BASE}/api/projects/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }));
  },

  async deleteProject(id: string) {
    return j<{ ok: boolean }>(await afetch(`${BASE}/api/projects/${id}`, { method: "DELETE" }));
  },

  async duplicateProject(id: string) {
    return j<Project>(await afetch(`${BASE}/api/projects/${id}/duplicate`, { method: "POST" }));
  },

  async addOverlay(id: string, body: Partial<Overlay>) {
    return j<Overlay>(await afetch(`${BASE}/api/projects/${id}/overlays`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  },

  async updateOverlay(id: string, overlayId: string, body: Partial<Overlay>) {
    return j<Overlay>(await afetch(`${BASE}/api/projects/${id}/overlays/${overlayId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  },

  async deleteOverlay(id: string, overlayId: string) {
    return j<any>(await afetch(`${BASE}/api/projects/${id}/overlays/${overlayId}`, { method: "DELETE" }));
  },

  async listAutozoom(id: string) {
    return j<{ id: string; enabled: boolean; start_ms: number; end_ms: number; scale: number }[]>(
      await afetch(`${BASE}/api/projects/${id}/autozoom`));
  },

  async generateAutozoom(id: string, scale: number) {
    return j<{ count: number; zooms: any[] }>(await afetch(`${BASE}/api/projects/${id}/autozoom/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scale }),
    }));
  },

  async clearAutozoom(id: string) {
    return j<any>(await afetch(`${BASE}/api/projects/${id}/autozoom`, { method: "DELETE" }));
  },

  async addZoom(id: string, start_ms: number, end_ms: number, scale: number) {
    return j<any>(await afetch(`${BASE}/api/projects/${id}/edits`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "zoom", payload_json: { start_ms, end_ms, scale }, enabled: true }),
    }));
  },

  async deleteEdit(id: string, editId: string) {
    return j<any>(await afetch(`${BASE}/api/projects/${id}/edits/${editId}`, { method: "DELETE" }));
  },

  async filterPresets() {
    return j<{ filters: { id: string; label: string }[] }>(await afetch(`${BASE}/api/filter-presets`));
  },
  async getFilter(id: string) {
    return j<{ name: string }>(await afetch(`${BASE}/api/projects/${id}/filter`));
  },
  async setFilter(id: string, name: string) {
    return j<{ name: string }>(await afetch(`${BASE}/api/projects/${id}/filter`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }));
  },

  async listImages(id: string) {
    return j<ImageOverlay[]>(await afetch(`${BASE}/api/projects/${id}/images`));
  },
  async addImage(id: string, file: File, start_ms: number, end_ms: number) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("start_ms", String(start_ms));
    fd.append("end_ms", String(end_ms));
    fd.append("x_pct", "50"); fd.append("y_pct", "20"); fd.append("size_pct", "40");
    return j<ImageOverlay>(await afetch(`${BASE}/api/projects/${id}/images`, { method: "POST", body: fd }));
  },
  async updateImage(id: string, imageId: string, body: Partial<ImageOverlay>) {
    return j<ImageOverlay>(await afetch(`${BASE}/api/projects/${id}/images/${imageId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  },
  async deleteImage(id: string, imageId: string) {
    return j<any>(await afetch(`${BASE}/api/projects/${id}/images/${imageId}`, { method: "DELETE" }));
  },

  async listBrolls(id: string) {
    return j<BrollClip[]>(await afetch(`${BASE}/api/projects/${id}/brolls`));
  },
  async addBroll(id: string, file: File, start_ms: number, end_ms: number) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("start_ms", String(start_ms));
    fd.append("end_ms", String(end_ms));
    fd.append("x_pct", "0"); fd.append("y_pct", "0"); fd.append("size_pct", "100");
    return j<BrollClip>(await afetch(`${BASE}/api/projects/${id}/brolls`, { method: "POST", body: fd }));
  },
  async updateBroll(id: string, brollId: string, body: Partial<BrollClip>) {
    return j<BrollClip>(await afetch(`${BASE}/api/projects/${id}/brolls/${brollId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  },
  async deleteBroll(id: string, brollId: string) {
    return j<any>(await afetch(`${BASE}/api/projects/${id}/brolls/${brollId}`, { method: "DELETE" }));
  },

  async getProject(id: string) {
    return j<ProjectDetail>(await afetch(`${BASE}/api/projects/${id}`));
  },

  async getStatus(id: string) {
    return j<{ status: string; error?: string | null; job?: any }>(
      await afetch(`${BASE}/api/projects/${id}/status`));
  },

  async upload(file: File, name?: string) {
    const fd = new FormData();
    fd.append("file", file);
    if (name) fd.append("name", name);
    return j<Project>(await afetch(`${BASE}/api/projects`, { method: "POST", body: fd }));
  },

  uploadWithProgress(file: File, onProgress?: (pct: number) => void, name?: string): Promise<Project> {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);
      if (name) fd.append("name", name);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/api/projects`);
      if (authToken) xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText) as Project); }
          catch (err) { reject(err); }
        } else {
          reject(new Error(`${xhr.status}: ${xhr.responseText}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(fd);
    });
  },

  async transcribe(id: string, language_code: string, mode: string) {
    return j<any>(await afetch(`${BASE}/api/projects/${id}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language_code, mode }),
    }));
  },

  async addCue(id: string, start_ms: number, end_ms: number, text = "") {
    return j<any>(await afetch(`${BASE}/api/projects/${id}/cues/add`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_ms, end_ms, text }),
    }));
  },

  async splitCue(id: string, cue_idx: number, split_ms?: number) {
    return j<any>(await afetch(`${BASE}/api/projects/${id}/cues/${cue_idx}/split`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ split_ms: split_ms ?? null }),
    }));
  },

  async mergeCue(id: string, cue_idx: number) {
    return j<any>(await afetch(`${BASE}/api/projects/${id}/cues/merge`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cue_idx }),
    }));
  },

  async deleteCue(id: string, cue_idx: number) {
    return j<any>(await afetch(`${BASE}/api/projects/${id}/cues/${cue_idx}`, { method: "DELETE" }));
  },

  async bulkDeleteCues(id: string, idxs: number[]) {
    return j<any>(await afetch(`${BASE}/api/projects/${id}/cues/bulk-delete`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idxs }),
    }));
  },

  async editCue(id: string, cue_idx: number, new_text: string) {
    return j<any>(await afetch(`${BASE}/api/projects/${id}/cues`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cue_idx, new_text }),
    }));
  },

  async exportSub(id: string, format: string, use_translit: boolean, apply_cuts = true, style = "classic", enhance_audio = false) {
    return j<{ export_id: string; status: string; format: string }>(
      await afetch(`${BASE}/api/projects/${id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, use_translit, apply_cuts, style, enhance_audio }),
      })
    );
  },

  async listExports(id: string) {
    return j<{ id: string; format: string; url: string | null; status: string }[]>(
      await afetch(`${BASE}/api/projects/${id}/exports`));
  },

  async detectSilences(id: string) {
    return j<{ threshold_db: number; count: number; silences: { start_ms: number; end_ms: number }[] }>(
      await afetch(`${BASE}/api/projects/${id}/silences`)
    );
  },

  async addEdit(id: string, type: string, payload_json: any) {
    return j<{ id: string; type: string; enabled: boolean }>(
      await afetch(`${BASE}/api/projects/${id}/edits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, payload_json }),
      })
    );
  },

  async detectFillers(id: string, aggressive = false) {
    return j<{ count: number; removed_ms: number;
      fillers: { start_ms: number; end_ms: number; text: string }[] }>(
      await afetch(`${BASE}/api/projects/${id}/fillers?aggressive=${aggressive}`));
  },

  async detectRetakes(id: string, threshold = 0.62) {
    return j<{ count: number; candidates: {
      similarity: number;
      kept: { idx: number; start_ms: number; end_ms: number; text: string };
      cuts: { idx: number; start_ms: number; end_ms: number; text: string }[];
    }[] }>(await afetch(`${BASE}/api/projects/${id}/retakes?threshold=${threshold}`));
  },

  async toggleEdit(id: string, editId: string, enabled: boolean) {
    return j<any>(await afetch(`${BASE}/api/projects/${id}/edits/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }));
  },
};
