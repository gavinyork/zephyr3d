#!/usr/bin/env node

import { StudioApp } from './app';

StudioApp.getInstance().startup(process.argv);
