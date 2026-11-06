import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const Ajv=require('ajv');
const validator=new Ajv({allErrors:true,formats:{double:()=>true,float:()=>true,uint8:()=>true,uint32:()=>true,uint64:()=>true,int32:()=>true,int64:()=>true},logger:false}).compile(require('@tauri-apps/cli/config.schema.json'));
if (!validator(JSON.parse(readFileSync('src-tauri/tauri.conf.json','utf8')))) throw Error(JSON.stringify(validator.errors));
console.log('TAURI_CONFIG_PASS');
