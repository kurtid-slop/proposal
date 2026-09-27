// Saves an image for the download buttons. On phones this opens the share
// sheet ("Save Image" puts it in Photos); elsewhere it's a normal download.
export async function saveImage(url, name, button) {
  button.disabled = true;
  button.dataset.label ||= button.textContent;
  button.textContent = 'saving...';
  try {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], name, { type: blob.type });
    const phone = window.matchMedia('(hover: none)').matches;
    if (phone && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] }).catch(() => {}); // cancelling is fine
    } else {
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    }
  } catch {
    window.open(url, '_blank'); // last resort: open it so it can be saved by hand
  } finally {
    button.textContent = button.dataset.label;
    button.disabled = false;
  }
}
