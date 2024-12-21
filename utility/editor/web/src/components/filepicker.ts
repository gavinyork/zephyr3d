export class FilePicker {
  static async chooseFiles(multi: boolean, accept: string): Promise<File[]> {
    return new Promise((resolve) => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = accept ?? '';
      fileInput.multiple = !!multi;
      fileInput.onchange = () => {
        resolve([...fileInput.files]);
      };
      fileInput.click();
    });
  }
  static async chooseDirectory(): Promise<File[]> {
    return new Promise((resolve) => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '';
      fileInput.multiple = false;
      fileInput.webkitdirectory = true;
      fileInput.onchange = () => {
        resolve([...fileInput.files]);
      };
      fileInput.click();
    });
  }
}
