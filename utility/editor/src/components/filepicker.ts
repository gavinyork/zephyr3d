export class FilePicker {
  static async chooseFiles(multi: boolean, accept?: string): Promise<File[]> {
    return new Promise((resolve) => {
      const fileInput = document.createElement('input');
      let settled = false;
      const finish = (files: File[]) => {
        if (!settled) {
          settled = true;
          resolve(files);
        }
      };
      fileInput.type = 'file';
      fileInput.accept = accept ?? '';
      fileInput.multiple = !!multi;
      fileInput.onchange = () => {
        finish([...fileInput.files!]);
      };
      fileInput.oncancel = () => finish([]);
      window.setTimeout(() => {
        window.addEventListener(
          'focus',
          () => {
            window.setTimeout(() => finish([...fileInput.files!]), 0);
          },
          { once: true }
        );
      }, 0);
      fileInput.click();
    });
  }
  static async chooseDirectory(): Promise<File[]> {
    return new Promise((resolve) => {
      const fileInput = document.createElement('input');
      let settled = false;
      const finish = (files: File[]) => {
        if (!settled) {
          settled = true;
          resolve(files);
        }
      };
      fileInput.type = 'file';
      fileInput.accept = '';
      fileInput.multiple = false;
      fileInput.webkitdirectory = true;
      fileInput.onchange = () => {
        finish([...fileInput.files!]);
      };
      fileInput.oncancel = () => finish([]);
      window.setTimeout(() => {
        window.addEventListener(
          'focus',
          () => {
            window.setTimeout(() => finish([...fileInput.files!]), 0);
          },
          { once: true }
        );
      }, 0);
      fileInput.click();
    });
  }
}
