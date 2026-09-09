// Original CC0 adapter of the public MIT Aseprite Document Library playback API.
#include <iostream>
#include <memory>
#include <vector>
#include "doc/playback.h"
#include "doc/sprite.h"
#include "doc/tag.h"
#include "doc/tags.h"
int main(){int frames,count,mode,start,active,steps,delta,forward;
 while(std::cin>>frames>>count>>mode>>start>>active>>steps>>delta>>forward){
  std::unique_ptr<doc::Sprite> s(doc::Sprite::MakeStdSprite(doc::ImageSpec(doc::ColorMode::RGB,1,1)));s->setTotalFrames(frames);std::vector<doc::Tag*> tags;
  for(int i=0;i<count;i++){int from,to,direction,repeat;std::cin>>from>>to>>direction>>repeat;auto t=new doc::Tag(from,to);t->setName(std::to_string(i));t->setAniDir(static_cast<doc::AniDir>(direction));t->setRepeat(repeat);s->tags().add(t);tags.push_back(t);}
  doc::Playback p(s.get(),s->tags().getInternalList(),start,static_cast<doc::Playback::Mode>(mode),active<0?nullptr:tags[active],forward);
  for(int i=0;i<steps;i++){std::cout<<p.frame()<<','<<(p.isStopped()?1:0)<<','<<(p.tag()?p.tag()->name():"-")<<' ';p.nextFrame(delta);}std::cout<<'\n';
 }
}
