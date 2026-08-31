"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const files = require("../src/js/remote-files.js");

test("remote paths preserve POSIX symlink traversal and literal shell characters",()=>{
  assert.equal(files.resolvePath("/home/user/links/../a '한글' $(touch x).txt"),"/home/user/links/../a '한글' $(touch x).txt");
  assert.equal(files.resolvePath("/a/file name "),"/a/file name ");
  assert.throws(()=>files.resolvePath("a.txt"));
  assert.throws(()=>files.resolvePath("~/a.txt"));
  assert.throws(()=>files.resolvePath("/x\ny"));
});
test("text preview omits incomplete multi-byte suffix without corrupting full-file decoding",()=>{
  const bytes=new TextEncoder().encode("abc한글");
  assert.equal(files.decodeText(bytes.subarray(0,bytes.length-1),true),"abc한");
  assert.throws(()=>files.decodeText(bytes.subarray(0,bytes.length-1),false));
  assert.equal(files.decodeText(new Uint8Array([255,254,65,0,66,0])),"AB");
  assert.throws(()=>files.decodeText(new Uint8Array([1,2,3])));
  assert.equal(files.textLines("a\n".repeat(10001)).lines.length,10000);
  assert.equal(files.textLines("a".repeat(10001)).limited,true);
});
test("CSV handles quotes, multiline cells, strings and partial trailing records",()=>{
  assert.deepEqual(files.parseTable('id,name\r\n001,"a\nb"\r\n=1+1,"say ""hi"""').rows,[['id','name'],['001','a\nb'],['=1+1','say "hi"']]);
  assert.deepEqual(files.parseTable('a,b\n1,"partial',",",true).rows,[["a","b"]]);
  assert.deepEqual(files.parseTable('a,b\n1,part',",",true).rows,[["a","b"]]);
  assert.throws(()=>files.parseTable('a,"oops'));
  assert.throws(()=>files.parseTable('a,"b"garbage'));
  assert.deepEqual(files.parseTable("a\tb\n1\t2","\t").rows,[["a","b"],["1","2"]]);
  assert.equal(files.parseTable("a,b\n".repeat(1002)).rows.length,1000);
  assert.equal(files.parseTable(Array(102).fill("a").join(",")).rows[0].length,100);
});
test("image header checks reject excessive allocation before decoding",()=>{
  const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write("IHDR",12);png.writeUInt32BE(1200,16);png.writeUInt32BE(800,20);
  assert.deepEqual(files.imageInfo(png),{width:1200,height:800,mime:"image/png",frameEnd:0});
  png.writeUInt32BE(100000,16);assert.throws(()=>files.imageInfo(png));
  assert.throws(()=>files.imageInfo(Buffer.from("<svg onload='danger()'>")));
  const gif=Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==","base64");
  const info=files.imageInfo(gif);assert.equal(info.width,1);assert.equal(info.height,1);assert.equal(gif[info.frameEnd],0x3b);
});
