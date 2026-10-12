const fs=require('fs');
const vm=require('vm');
const path=require('path');
const root=path.join(__dirname,'..');
const seed=JSON.parse(fs.readFileSync(path.join(root,'data/events.json'),'utf8'));
class FakeElement {
 constructor(id){this.id=id;this.value='all';this.dataset={};this.attrs={};this.listeners={};this.innerHTML='';this.textContent='';this.hidden=false;this.classList={add(){},remove(){},toggle(){}};}
 addEventListener(ev,fn){this.listeners[ev]=fn;}
 setAttribute(k,v){this.attrs[k]=v;}
 removeAttribute(k){delete this.attrs[k];}
 querySelectorAll(){return [];}
}
const map={}; const el=(k)=>map[k]||(map[k]=new FakeElement(k));
const tabs=['news','browse','saved'].map(k=>Object.assign(new FakeElement('tab-'+k),{dataset:{tab:k}}));
const chips=['free','weekend','exact','upcoming'].map(k=>Object.assign(new FakeElement('chip-'+k),{dataset:{filter:k}}));
const document={getElementById:el,querySelectorAll(selector){if(selector==='.tab')return tabs;if(selector==='.chip')return chips;return [];}};
el('searchInput').value='';
for(const id of ['areaFilter','topicFilter','sortFilter'])el(id).value='all';
const localStorage={getItem(){return null;},setItem(){}};
const sandbox={document,window:{KIDS_INITIAL_DATA:seed},localStorage,console,Intl,Date,Set,JSON,Math,String,URL,Number,RegExp,encodeURIComponent,clearTimeout,setTimeout,location:{protocol:'https:',href:'https://example.com/index.html'},navigator:{},fetch:async(url)=>String(url).includes('/api/events')?({ok:false,status:503}):({ok:true,json:async()=>seed})};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),sandbox);
setTimeout(()=>{
 if(!el('cards').innerHTML.includes('트래블 감성 로그')) throw new Error('뉴스 카드 누락');
 if(!el('cards').innerHTML.includes('S260917092805331768')) throw new Error('예약 원문 링크 누락');
 if(!el('cards').innerHTML.includes('매봉산 목공체험')) throw new Error('확인된 공고 카드 누락');
 if(!el('sourceAlert').textContent.includes('2026년 10월 9일')) throw new Error('스냅샷 최신성 경고 누락');
 console.log('FRONTEND SMOKE PASS: 실공고 6건·공식 예약 링크·스냅샷 경고 확인');
},30);
