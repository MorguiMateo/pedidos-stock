export async function downloadText(filename: string, content: string, mime: string): Promise<void> {
  return downloadFile(filename, content, mime);
}

export async function downloadFile(filename: string, content: string | Uint8Array, mime: string): Promise<void> {
  const bytes = typeof content === 'string' ? content : new Uint8Array(content).buffer;
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
