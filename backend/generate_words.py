"""
Word list generator for Word Territory.
Run this script to regenerate words.txt.

Requirements (build-time only, NOT needed at runtime):
    pip install wordfreq pyenchant

Sources:
    wordfreq: CC BY-SA 4.0  https://github.com/rspeer/wordfreq
    pyenchant / en_US dict: LGPL
"""

import wordfreq
import enchant

d = enchant.Dict("en_US")

BLACKLIST = {
    "the","and","for","you","was","are","not","but","his","can",
    "out","has","who","had","her","get","she","its","our","any",
    "via","per","nor","yet","too","let","put","got","did","own",
    "may","say","him","off","ago","yes","two","how","now","new",
    "all","one","use","way","day","man","men","act","age","aim",
    "air","ask","bit","buy","cut","due","fly","fun","hit","sit",
    "win","mix","fix","tax","pay","add","aid","bar","bay","bed",
    "bow","boy","bug","bus","cap","car","cop","cow","cry","cup",
    "dad","die","dig","dip","dog","dot","dry","ear","eve","eye",
    "fan","fed","fee","fog","foe","fur","gap","gas","gel","gem",
    "god","gun","gut","guy","gym","hip","hop","hub","hug","hut",
    "ice","ink","ion","jam","jar","jaw","jet","joy","key","kid",
    "kit","lab","lap","lay","leg","lip","log","low","mad","mid",
    "mob","mom","mud","mug","nap","net","nil","nod","nun","oak",
    "odd","oil","opt","ore","owe","pad","pan","paw","pea","pen",
    "pet","pie","pig","pin","pit","pod","pop","pot","pro","pub",
    "pun","pup","rat","raw","ray","rep","rid","rig","rip","rob",
    "rod","row","rub","rug","sag","sap","saw","sec","shy","sin",
    "sip","sir","ski","sky","sow","spa","spy","sty","sue","sum",
    "tab","tan","tap","tar","ten","tie","tin","tip","toe","ton",
    "tow","toy","tug","urn","van","vat","vow","wad","war","web",
    "wed","wet","wig","wit","woe","wok","won","woo","wow","yam",
    # abbreviations / archaisms
    "ane","nae","roo","rte","assn","attn","arr","ans","ert","str",
    "ese","sse","ene","wnw","wsw","ssw","nne",
    # proper nouns
    "anna","ares","anas","asst","mars","zeus","rome","troy",
    "eden","nero","ajax","thor","isis","abel","adam","ruth","mark",
    "luke","john","paul","kent","iowa","ohio","utah","yale","ford",
    "dell","ibis",
    # profanity / inappropriate (keep list comprehensive for regeneration)
    "anal","ass","asses","bitch","bong","boob","boobs","booty","bowel",
    "chink","cock","cocks","condom","crack","crap","cum","cums","cunt","cunts",
    "damn","dick","dicks","dildo","dyke","erect","faggot","fart",
    "fuck","fucked","fucker","fucks","grope","hell","heroin","honky","horny",
    "incest","junkie","killed","killer","lynch","meth","molest","murder",
    "naked","nigga","niggas","nigger","nipple","noose","nude","nudes","nudist",
    "orgasm","pee","penis","piss","poop","porn","pussy","rape","raped","rapes",
    "rapist","retard","retards","semen","sex","sexy","shit","shits","shitty",
    "slut","sluts","sperm","stoner","tits","turd","tranny","vagina","vulva",
    "weed","wetback","whore","whores",
}

top = wordfreq.top_n_list("en", 800000)
game_words = []

for w in top:
    if not w.isalpha():
        continue
    wl = w.lower()
    if not 3 <= len(wl) <= 6:
        continue
    if wl in BLACKLIST:
        continue
    z = wordfreq.zipf_frequency(wl, "en")
    min_z = 3.5 if len(wl) == 3 else 2.5
    if min_z <= z <= 5.8 and d.check(wl):
        game_words.append(wl)

game_words = list(dict.fromkeys(game_words))
game_words.sort()

out = __import__("pathlib").Path(__file__).parent / "words.txt"
out.write_text("\n".join(game_words), encoding="utf-8")
print(f"Written {len(game_words)} words to {out}")
