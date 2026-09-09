// Give local-site links real hosted URLs so keyboard, middle-click and context
// menu navigation work in the downloaded browser build and Electron wrapper.
export function hostedDestination(href,storefront) {
  if (typeof href!=='string' || !href.startsWith('/') || href.startsWith('//')) return null;
  const base=new URL(storefront);
  if (base.protocol!=='https:') throw new Error('Hosted navigation requires an HTTPS storefront.');
  const destination=new URL(href,base.origin);
  return destination.origin===base.origin?destination.href:null;
}

export function installHostedLinks(document,storefront,Observer=globalThis.MutationObserver) {
  function update(node) {
    if (node?.matches?.('a[href]')) {
      const destination=hostedDestination(node.getAttribute('href'),storefront);
      if (destination) {
        node.setAttribute('href',destination);
        node.setAttribute('target','_blank');
        const rel=new Set((node.getAttribute('rel')??'').split(/\s+/).filter(Boolean));
        rel.add('noopener');rel.add('noreferrer');
        node.setAttribute('rel',[...rel].join(' '));
      }
    }
    for (const anchor of node?.querySelectorAll?.('a[href]')??[]) update(anchor);
  }
  update(document);
  const observer=new Observer(records=>{
    for(const record of records){
      if(record.type==='attributes') update(record.target);
      else for(const node of record.addedNodes) update(node);
    }
  });
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});
  return ()=>observer.disconnect();
}
