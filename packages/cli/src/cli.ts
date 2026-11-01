#!/usr/bin/env node
import { runMain } from 'citty';
import { setupCompletion } from './completion.ts';
import { main } from './main.ts';

await setupCompletion(main);
void runMain(main);
