<script setup lang="ts">
import { nextTick, onMounted, watch } from 'vue';
import { useRoute, withBase } from 'vitepress';

const route = useRoute();

function mountShowcases() {
  const nodes = document.querySelectorAll<HTMLElement>('.showcase:not([data-showcase-mounted])');
  for (const node of nodes) {
    const caseName = node.getAttribute('case');
    if (!caseName) {
      continue;
    }

    node.dataset.showcaseMounted = 'true';
    const noCode = node.getAttribute('nocode') !== null;
    const iframe = document.createElement('iframe');
    const page = noCode ? '/showdemo.html' : '/showcase.html';
    iframe.src = `${withBase(page)}?showcase=${encodeURIComponent(caseName)}${noCode ? '&nocode' : ''}`;
    iframe.title = `Zephyr3d showcase ${caseName}`;
    iframe.loading = 'lazy';
    iframe.className = 'zephyr-showcase-frame';
    node.append(iframe);
  }
}

function scheduleMount() {
  nextTick(() => {
    window.requestAnimationFrame(mountShowcases);
  });
}

onMounted(scheduleMount);
watch(() => route.path, scheduleMount);
</script>

<template></template>
