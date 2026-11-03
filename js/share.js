// Системное меню телефона для картинок: сохранить в галерею или отправить без архива.

// Только на телефонах и планшетах: на компьютере удобнее архив.
export function canShareImages() {
  try {
    return matchMedia('(pointer: coarse)').matches
      && !!navigator.canShare?.({ files: [new File([''], 'a.jpg', { type: 'image/jpeg' })] });
  } catch { return false; }
}

export const imageFile = (name, blob) => new File([blob], name, { type: 'image/jpeg' });

// build() готовит File[]. run() возвращает true, если меню недоступно и нужен архив.
export function createImageShare({ button, title, build, toast }) {
  const label = button.textContent;
  let prepared = null;
  const reset = () => { prepared = null; button.textContent = label; };

  async function run() {
    const secondTry = !!prepared;
    const files = prepared || await build();
    if (!navigator.canShare({ files })) {
      reset();
      toast('Для меню слишком много файлов — скачиваю архивом');
      return true;
    }
    try {
      await navigator.share({ files, title });
      reset();
    } catch (e) {
      if (e?.name === 'AbortError') { reset(); return false; }
      // Пока файлы готовились, браузер мог перестать считать это нажатием: нужно ещё одно.
      if (e?.name === 'NotAllowedError' && !secondTry) {
        prepared = files;
        button.textContent = 'Готово — нажмите ещё раз';
        return false;
      }
      reset();
      toast('Не удалось открыть меню — скачиваю архивом');
      return true;
    }
    return false;
  }

  return { run, reset };
}
