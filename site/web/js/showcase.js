import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import vhtml from 'highlight.js/lib/languages/vbscript-html';
import hlstyle from 'highlight.js/styles/atom-one-dark.css';

let caseName = null;
let code = null;
let html = null;
let liveDemo = null;
let debounce = false;

async function showCode() {
  if (!code) {
    const content = await (await fetch(`tut/${caseName}.main.js`)).text();
    code = document.createElement('pre');
    const codeElement = document.createElement('code');
    codeElement.classList.add('hljs');
    code.append(codeElement);
    const highlightCode = hljs.highlight(content, {
      language: 'javascript'
    }).value;
    codeElement.innerHTML = highlightCode;
  }
  html?.remove();
  liveDemo?.remove();
  const parent = document.querySelector('#content');
  if (!code.parentElement) {
    parent.append(code);
  }
}

async function showHtml() {
  if (!html) {
    const content = await (await fetch(`tut/${caseName}.html`)).text();
    html = document.createElement('pre');
    const codeElement = document.createElement('code');
    codeElement.classList.add('hljs');
    html.append(codeElement);
    const highlightCode = hljs.highlight(content, {
      language: 'html'
    }).value;
    codeElement.innerHTML = highlightCode;
  }
  code?.remove();
  liveDemo?.remove();
  const parent = document.querySelector('#content');
  if (!html.parent) {
    parent.append(html);
  }
}

async function showLiveDemo() {
  if (!liveDemo) {
    liveDemo = document.createElement('iframe');
    liveDemo.src = `tut/${caseName}.html`; //`examples/dist/${el.getAttribute('case')}`
    liveDemo.style.border = "0";
    liveDemo.style.position = 'absolute';
    liveDemo.style.left = '0px';
    liveDemo.style.right = '0px';
    liveDemo.style.width = '100%';
    liveDemo.style.height = '100%';
  }
  code?.remove();
  html?.remove();
  const parent = document.querySelector('#content');
  if (!liveDemo.parentElement) {
    parent.append(liveDemo);
  }
}

window.onload = function () {
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('html', vhtml);
  for (const style of [hlstyle]) {
    const styleElement = document.createElement('style');
    styleElement.append(style);
    document.head.append(styleElement);
  }
  caseName = new URL(location.href).searchParams.get('showcase');
  const action = function (func) {
    if (!debounce && !this.classList.contains('active')) {
      debounce = true;
      this.parentElement.querySelectorAll('button').forEach(value => {
        value.classList.remove('active');
      });
      this.classList.add('active');
      func().then(() => {
        debounce = false;
      }).catch(err => {
        debounce = false;
      });
    }
  }
  const btnShowJs = document.querySelector('#show-code');
  btnShowJs.addEventListener('click', function () {
    action.call(btnShowJs, showCode);
  });
  const btnShowHTML = document.querySelector('#show-html');
  btnShowHTML.addEventListener('click', function () {
    action.call(btnShowHTML, showHtml);
  });
  const btnShowLiveDemo = document.querySelector('#live-demo');
  btnShowLiveDemo.addEventListener('click', function () {
    action.call(btnShowLiveDemo, showLiveDemo);
  });
  action.call(btnShowLiveDemo, showLiveDemo);
};
