// Original CC0 test adapter. Calls locally compiled MIT document-library APIs.
// The executable and Aseprite application are not redistributed with fixtures.
#include <iostream>
#include <memory>
#include "doc/image.h"
#include "doc/algorithm/rotsprite.h"
#include "doc/algorithm/rotate.h"
int main(){int method,format,w,h,dw,dh,hasMask,q[8];unsigned int transparent;
while(std::cin>>method>>format>>w>>h>>dw>>dh>>transparent>>hasMask){
 for(int &v:q)std::cin>>v;
 auto source=std::unique_ptr<doc::Image>(doc::Image::create(static_cast<doc::PixelFormat>(format),w,h));
 auto dest=std::unique_ptr<doc::Image>(doc::Image::create(static_cast<doc::PixelFormat>(format),dw,dh));
 source->setMaskColor(transparent);dest->setMaskColor(transparent);source->clear(transparent);dest->clear(transparent);
 unsigned int p;for(int y=0;y<h;y++)for(int x=0;x<w;x++){std::cin>>p;source->putPixel(x,y,p);}
 std::unique_ptr<doc::Image> mask;if(hasMask){mask.reset(doc::Image::create(doc::IMAGE_BITMAP,w,h));for(int y=0;y<h;y++)for(int x=0;x<w;x++){std::cin>>p;mask->putPixel(x,y,p);}}
 if(method)doc::algorithm::rotsprite_image(dest.get(),source.get(),mask.get(),q[0],q[1],q[2],q[3],q[4],q[5],q[6],q[7]);
 else doc::algorithm::parallelogram(dest.get(),source.get(),mask.get(),q[0],q[1],q[2],q[3],q[4],q[5],q[6],q[7]);
 for(int y=0;y<dh;y++)for(int x=0;x<dw;x++)std::cout<<dest->getPixel(x,y)<<' ';std::cout<<'\n';
}}
