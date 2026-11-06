import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'../../tests/e2e',testMatch:'enterprise-workbook.spec.ts',workers:1,retries:0,timeout:180000,expect:{timeout:45000},reporter:'list',use:{baseURL:'http://localhost:3512',headless:true,viewport:{width:1440,height:1000},locale:'ru-RU',actionTimeout:30000}});
