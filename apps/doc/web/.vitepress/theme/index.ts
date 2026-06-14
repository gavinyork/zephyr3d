import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import ShowcaseEnhancer from './ShowcaseEnhancer.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'layout-bottom': () => h(ShowcaseEnhancer)
    });
  }
};
