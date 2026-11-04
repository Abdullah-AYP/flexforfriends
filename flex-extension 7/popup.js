const DEFAULTS = {
  dark: true,
  bgAttendance: false,
  bgMarks: false,
  bgTranscript: false,
  voiceLang: "en-US",
  fillComments: true,
  comments: [
    "Great course overall, the instructor explained concepts clearly.",
    "Lectures were well organized and the pace was good.",
    "Helpful and approachable instructor. Enjoyed the course.",
    "Good course content and fair assessments.",
    "The instructor was supportive and the material was relevant.",
    "Overall a positive learning experience."
  ]
};
const el = (id) => document.getElementById(id);
chrome.storage.sync.get(Object.keys(DEFAULTS), (saved) => {
  const s = { ...DEFAULTS, ...saved };
  el("dark").checked = s.dark;
  el("fillComments").checked = s.fillComments;
  el("bgAttendance").checked = s.bgAttendance;
  el("bgMarks").checked = s.bgMarks;
  el("bgTranscript").checked = s.bgTranscript;
  el("voiceLang").value = s.voiceLang;
  el("comments").value = s.comments.join("\n");
});
["dark", "fillComments", "bgAttendance", "bgMarks", "bgTranscript"].forEach((id) =>
  el(id).addEventListener("change", () => chrome.storage.sync.set({ [id]: el(id).checked }))
);
el("voiceLang").addEventListener("change", () => chrome.storage.sync.set({ voiceLang: el("voiceLang").value }));
el("comments").addEventListener("input", () => {
  const list = el("comments").value.split("\n").map((x) => x.trim()).filter(Boolean);
  chrome.storage.sync.set({ comments: list.length ? list : DEFAULTS.comments });
});
