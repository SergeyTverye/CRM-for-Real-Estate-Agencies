import { mkdir, writeFile } from 'node:fs/promises';
const size=32, xor=size*size*4, mask=size*4, image=Buffer.alloc(40+xor+mask);
image.writeUInt32LE(40,0); image.writeInt32LE(size,4); image.writeInt32LE(size*2,8);
image.writeUInt16LE(1,12); image.writeUInt16LE(32,14); image.writeUInt32LE(xor,20);
for(let y=0;y<size;y++) for(let x=0;x<size;x++){
  const i=40+((size-1-y)*size+x)*4;
  const building=x>=8&&x<24&&y>=5&&y<28;
  const window=building&&x>=11&&x<21&&y>=9&&y<23&&((x-11)%5<3)&&((y-9)%6<3);
  const color=window?[243,247,255]:building?[255,255,255]:[150,72,24];
  image[i]=color[0];image[i+1]=color[1];image[i+2]=color[2];image[i+3]=255;
}
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);
header[6]=size;header[7]=size;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);
header.writeUInt32LE(image.length,14);header.writeUInt32LE(22,18);
await mkdir('src-tauri/icons',{recursive:true});
await writeFile('src-tauri/icons/icon.ico',Buffer.concat([header,image]));
