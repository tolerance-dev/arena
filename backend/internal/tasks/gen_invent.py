"""The voted tasks' data (called by gen_data.py): a messenger to invent and a city-trip planner startup.

These tasks have no API contract and almost no checks: the agent designs the product, people rank it in blind
votes. The data is what makes a prototype feel real, so it is hand-written where it matters (conversations, places)
and padded with generated filler. Deterministic: its own Random, so it never shifts the other tasks' data.
"""
import datetime, json, os

import random

R = random.Random(20261027)


def dump(out, task, name, obj):
    d = os.path.join(out, task, "data")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, name), "w") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


# =====================================================================================================================
# messenger
# =====================================================================================================================

NOW = datetime.datetime(2026, 11, 20, 18, 0, tzinfo=datetime.timezone.utc)  # Lisbon is UTC in November


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


ME = {"id": "u0", "name": "Alex Morgan", "username": "alexm", "phone": "+351 912 345 678",
      "bio": "Product designer in Lisbon. Coffee, bikes, bad puns.", "timezone": "Europe/Lisbon", "now": iso(NOW)}

# (id, name as saved in the address book, username, bio)
PEOPLE = [
    ("u1", "Mia Chen", "miachen", "🌿 ceramics & long walks"),
    ("u2", "Mom", "helen.morgan", ""),
    ("u3", "Dad", "rob.morgan", "Retired. Fishing whenever possible."),
    ("u4", "Kate Morgan", "katem", "Architect · Porto"),
    ("u5", "Grandma Rose", "rose1941", ""),
    ("u6", "Sam Rivera", "samr", "Head of Product @ Lumen"),
    ("u7", "Priya Nair", "priya.n", "Design systems @ Lumen"),
    ("u8", "Jonas Berg", "jonasb", "bass, beer, bad decisions"),
    ("u9", "Lena Novak", "lenanovak", "Berlin ✈️ Lisbon"),
    ("u10", "Rui Duarte (landlord)", "rui.duarte", ""),
    ("u11", "Theo Park", "theopark", "Talent partner · hiring designers"),
    ("u12", "Clínica São Bento", "clinica.sb", "Appointments Mon–Fri 8:00–19:00"),
    ("u13", "Marco Rossi", "marcor", "⚽️"),
    ("u14", "Hugo Garcia", "hugog", "Always booking the next trip"),
    ("u15", "Iris Kowalski", "irisk", "Books > people (sometimes)"),
    ("u16", "Felix Muller", "felixm", "Frontend @ Lumen"),
    ("u17", "Greta Berg", "gretab", ""),
    ("u18", "Leo Petrov", "leop", "Climbing 7a, coding 5c"),
    ("u19", "Ana Costa", "anacosta", "Flat 3B"),
    ("u20", "Tiago Santos", "tiagos", "Building admin, flat 1A"),
    ("u21", "Joana Pereira", "joanap", "Flat 4C · two cats"),
    ("u22", "Nuno Alves", "nunoalves", ""),
    ("u23", "Beatriz Lima", "bialima", "Research @ Lumen"),
    ("u24", "David Smith", "dsmith", ""),
    ("u25", "Elena Ivanova", "elenai", "Reading Murakami again"),
    ("u26", "Omar Haddad", "omarh", "Goalkeeper, reluctantly"),
    ("u27", "Sofia Ricci", "sofiar", ""),
    ("u28", "Ben Carter", "bencarter", "Old school, new beard"),
    ("u29", "Yuki Tanaka", "yukit", "QA @ Lumen"),
    ("u30", "Noah Fischer", "noahf", "Climbing & coffee"),
    ("u31", "Clara Silva", "clarasilva", "Flat 2A"),
    ("u32", "Ines Rocha", "inesrocha", ""),
    ("u33", "Pedro Matos", "pedrom", "Flat 5B"),
    ("u34", "Laura Kim", "laurakim", "School reunion organiser-in-chief"),
]


def contacts():
    res = []
    for i, (uid, name, username, bio) in enumerate(PEOPLE):
        seen = NOW - datetime.timedelta(minutes=R.choice([0, 0, 3, 12, 45, 90, 240, 600, 1500, 4000]))
        c = {"id": uid, "name": name, "username": username, "phone": f"+351 9{R.randint(10, 69)} {R.randint(100, 999)} {R.randint(100, 999)}",
             "bio": bio, "online": seen == NOW, "last_seen": iso(seen)}
        res.append(c)
    by = {c["id"]: c for c in res}
    by["u4"]["birthday"] = "11-27"  # Kate: the surprise party is for her
    by["u5"]["birthday"] = "11-22"  # Grandma: the day after tomorrow
    by["u9"]["phone"] = "+49 151 2345 6789"
    return res


# Message options: a = attachment, r = replies to the message k lines earlier (r=1: the one just before), x = reactions
# {emoji: [user ids]}, g = minutes until the next line (default random), e = edited, f = forwarded from.
def photo(name, caption=None, w=1600, h=1200):
    a = {"type": "photo", "name": name, "width": w, "height": h}
    if caption:
        a["caption"] = caption
    return a


def file(name, kb):
    return {"type": "file", "name": name, "size_kb": kb}


def voice(s, transcript):
    return {"type": "voice", "duration_s": s, "transcript": transcript}


def link(url, title):
    return {"type": "link", "url": url, "title": title}


def place(title, address, lat, lon):
    return {"type": "location", "title": title, "address": address, "lat": lat, "lon": lon}


def poll(question, options):
    return {"type": "poll", "question": question, "options": [{"text": t, "votes": v} for t, v in options]}


# Each chat: its fields, how long ago its last message was (minutes), how many of the last messages the user hasn't
# read, the conversation (oldest first) and how many filler lines from FILLER go before it.
CHATS = [
    dict(id="c1", type="direct", with_="u1", pinned=True, last=6, unread=2, lines=[
        ("u1", "Morning ☀️ did you sleep at all after that deadline?", {"g": 5}),
        ("me", "Barely. 4 hours. Coffee is my personality today", {}),
        ("u1", "Poor thing. Dinner tonight to make up for it?", {}),
        ("me", "Yes please. Somewhere new?", {}),
        ("u1", "There's this tasca Joana keeps talking about", {"g": 2}),
        ("u1", "", {"a": place("Tasca do Zé", "Rua da Atalaia 57, Bairro Alto", 38.7127, -9.1449)}),
        ("u1", "Table for 2 at 19:30, I booked it ✌️", {"x": {"❤️": ["u0"]}}),
        ("me", "You're the best. Do we need cash there?", {}),
        ("u1", "Cash only I think, bring like 40€", {"r": 1}),
        ("me", "ok, will stop at the ATM", {"g": 180}),
        ("u1", "", {"a": photo("IMG_2231.jpg", "the new mug came out of the kiln!! 🫖", 1200, 1600), "x": {"😍": ["u0"]}}),
        ("me", "That glaze is incredible", {}),
        ("u1", "Can you pick up oat milk on the way home? We're out", {"g": 240}),
        ("u1", "Also my mom asks if we're coming on Sunday", {"g": 3}),
        ("u1", "Leaving the studio in 20 min", {}),
    ]),
    dict(id="c2", type="group", title="Design team", members=["u6", "u7", "u16", "u23", "u29"], last=14, unread=6, filler=70, lines=[
        ("u6", "Reminder: roadmap review with the leadership is Monday 10:00. Decks in this chat by Friday EOD please", {"g": 30}),
        ("u7", "Onboarding flow v3 is in Figma, comments welcome", {"a": link("https://figma.example/file/onb-v3", "Onboarding v3 — Figma")}),
        ("u16", "The new date picker breaks on Safari 17, fixing", {}),
        ("u29", "Found 3 more bugs in checkout, tickets in the board", {"g": 60}),
        ("u23", "Interview notes from the 6 usability sessions", {"a": file("usability-round-2-notes.pdf", 842)}),
        ("u23", "TL;DR: nobody finds the 'save for later' button 🙃", {"r": 1, "x": {"😂": ["u7", "u16"], "😭": ["u0"]}}),
        ("u6", "@alexm can you review the Q4 deck by Friday? Mainly the pricing slides", {"a": file("Q4-roadmap-draft.pdf", 5230)}),
        ("u7", "@alexm also need your eyes on the empty states before Monday 🙏", {}),
        ("u16", "deploying the fix now", {"g": 4}),
        ("u16", "done, Safari is happy", {"x": {"🎉": ["u6", "u7", "u29"]}}),
        ("u29", "Who took my charger from the meeting room 👀", {}),
        ("u23", "Friday drinks at 18:30 at the usual place?", {"a": poll("Friday drinks?", [("I'm in 🍻", ["u16", "u23", "u29"]), ("Next week", ["u6"]), ("Can't", [])])}),
    ]),
    dict(id="c3", type="group", title="Azores trip", members=["u8", "u14", "u15", "u1"], last=35, unread=12, filler=40, lines=[
        ("u14", "OK people. Azores, 12–16 Dec. Who's in for real?", {}),
        ("u14", "", {"a": poll("Which dates work?", [("12–16 Dec", ["u14", "u15", "u1"]), ("19–23 Dec", ["u8"]), ("January", [])])}),
        ("u8", "December is chaos at work but I'll make it work", {}),
        ("u15", "Found a house in Ponta Delgada, 4 rooms, 640€ total for 4 nights", {"a": link("https://stays.example/azores/ponta-delgada-4br", "Casa Azul — 4 bedrooms · Ponta Delgada")}),
        ("u1", "That's 128 each if we're 5, love it", {"r": 1}),
        ("u14", "Flights are 89€ return right now from LIS", {}),
        ("u14", "I can book the house today if everyone sends me 128€", {"x": {"👍": ["u15", "u1"]}}),
        ("u15", "Sent ✅", {}),
        ("u1", "Sent too", {}),
        ("u14", "@alexm @jonasb waiting for you two 👀", {"g": 50}),
        ("u8", "Sending tonight, promise", {}),
        ("u15", "Do we rent a car? Hiking Sete Cidades without one is a pain", {}),
        ("u14", "Car is ~35€/day split 5 ways, easy yes", {}),
    ]),
    dict(id="c4", type="direct", with_="u6", last=70, unread=0, lines=[
        ("u6", "Hey, got a minute today?", {"g": 3}),
        ("me", "Sure, what's up?", {}),
        ("u6", "Leadership wants the pricing page redesign in Q1 instead of Q2", {}),
        ("u6", "Can you scope it roughly? Just t-shirt sizes", {}),
        ("me", "I'd say M for the page, L if we touch checkout", {"g": 200}),
        ("u6", "Perfect, that's what I needed", {"x": {"🙏": ["u0"]}}),
        ("u6", "And can you send me the deck by Friday? I want to read it before Monday", {}),
        ("u6", "No rush today, enjoy your evening", {}),
    ]),
    dict(id="c5", type="group", title="Family", members=["u2", "u3", "u4", "u5"], pinned=True, last=95, unread=4, filler=45, lines=[
        ("u2", "Grandma turns 85 on Sunday!! Lunch at our place at 13:00, everyone please confirm", {"x": {"❤️": ["u4", "u3"]}}),
        ("u4", "I'll be there, coming from Porto on Saturday", {}),
        ("u3", "I'm doing the grill", {"r": 2}),
        ("u5", "Don't make a fuss for me please", {}),
        ("u2", "Too late mum 😄", {"r": 1}),
        ("u2", "", {"a": photo("grandma_1962.jpg", "found this in the attic!", 1100, 1500), "x": {"😍": ["u4", "u3"]}}),
        ("u4", "She looks like a film star", {}),
        ("u2", "Alex are you bringing Mia?", {}),
        ("u2", "", {"a": voice(38, "Alex, darling, just call me when you can, it's about the gift for grandma, I had an idea about the photo album, okay, kisses")}),
        ("u3", "Who's picking up the cake from Pastelaria Aloma? Order is under Morgan, paid already", {}),
    ]),
    dict(id="c6", type="direct", with_="u8", last=150, unread=1, lines=[
        ("u8", "Concert tickets for Saturday!! I bought 2", {"a": file("tickets-capitolio-sat.pdf", 312)}),
        ("me", "Legend. How much do I owe you?", {}),
        ("u8", "45€ for yours", {}),
        ("me", "Sending now", {"g": 5}),
        ("me", "Done, check MB Way", {}),
        ("u8", "Got it 🙌", {"x": {"👍": ["u0"]}, "g": 1200}),
        ("u8", "Btw I still have your drill since summer lol. Bring it Saturday?", {}),
        ("me", "Ha, I forgot it existed. Yes bring it", {"g": 400}),
        ("u8", "Doors at 21:00, meet at Cais do Sodré at 20:15?", {}),
    ]),
    dict(id="c7", type="group", title="Building 12 · neighbours", members=["u19", "u20", "u21", "u22", "u31", "u32", "u33", "u24"], muted=True, last=210, unread=38, filler=110, lines=[
        ("u20", "IMPORTANT: water will be off on Saturday 21 Nov from 9:00 to 13:00 for pipe repairs in the basement", {"x": {"👍": ["u19", "u21", "u33"]}}),
        ("u21", "Thanks Tiago! Does that include hot water too?", {"r": 1}),
        ("u20", "Yes, everything", {"r": 1}),
        ("u31", "Whose bike is blocking the entrance again 🙄", {}),
        ("u33", "Sorry, mine, moving it", {}),
        ("u19", "Lost: black cat with a white paw, answers to Pimenta. Last seen near the bins", {"a": photo("pimenta.jpg", None, 1200, 1200)}),
        ("u21", "I'll keep an eye out 🐈‍⬛", {}),
        ("u20", "Reminder: building meeting on Wed 25 Nov, 19:00, ground floor. We vote on painting the stairwell (~140€ per flat)", {}),
        ("u22", "Can someone accept a parcel for me tomorrow? Flat 2B", {}),
        ("u32", "Pimenta is back home, she was in the garage 😅", {"x": {"❤️": ["u19", "u21", "u31", "u22"]}}),
    ]),
    dict(id="c8", type="direct", with_="u10", last=600, unread=1, lines=[
        ("u10", "Good afternoon Alex. The plumber can come on Tuesday 24 Nov between 10:00 and 12:00 for the bathroom leak. Will someone be home?", {"g": 30}),
        ("me", "Hi Rui, yes I'll work from home that morning", {}),
        ("u10", "Perfect, his name is Carlos, he will call 10 minutes before", {"g": 2000}),
        ("u10", "Also a reminder that from January the rent will be 1,150€ as we discussed. I'll send the updated contract", {}),
        ("u10", "", {"a": file("contract-addendum-2027.pdf", 198)}),
        ("u10", "Please sign and send it back by 30 November", {}),
    ]),
    dict(id="c9", type="group", title="Kate's 30th 🤫 (no Kate!)", members=["u2", "u1", "u14", "u17", "u25"], last=300, unread=3, filler=15, lines=[
        ("u17", "Surprise party for Kate: Friday 27 Nov, 20:00, the rooftop at Park bar. She thinks it's dinner with me", {}),
        ("u2", "She'll cry, I know her 😄", {}),
        ("u17", "Gift: the Leica she's been eyeing, 600€ total → 20€ each from 30 people", {}),
        ("u17", "Paid so far: Mom, Mia, Hugo, Elena, me. Alex? 👀", {}),
        ("u25", "I made a playlist, add songs", {"a": link("https://music.example/playlist/kate30", "Kate turns 30 🎉 — 47 songs")}),
        ("u14", "I'll bring the projector for the slideshow", {}),
        ("u17", "Everyone send me 1–2 photos with Kate by Wednesday please!", {}),
    ]),
    dict(id="c10", type="direct", with_="u9", last=1500, unread=2, lines=[
        ("u9", "", {"a": voice(74, "Heyyy, it's me, sorry for the voice message, I'm walking. So I'm coming to Lisbon from the 3rd to the 8th of December for work, and I'd love to see you, maybe the 5th? Let me know, okay, miss you, bye")}),
        ("me", "LENA! Yes! The 5th is perfect", {}),
        ("u9", "Yay! Can I crash on your sofa the last night? The hotel ends on the 7th", {}),
        ("me", "Of course, Mia will be happy too", {"g": 3000}),
        ("u9", "", {"a": photo("berlin_snow.jpg", "it's already snowing here 🥶")}),
        ("u9", "", {"a": voice(21, "Also, what's the name of that pastry place you love? I want to bring my colleagues")}),
    ]),
    dict(id="c11", type="direct", with_="u12", last=2900, unread=0, lines=[
        ("u12", "Clínica São Bento: your appointment with Dr. Silva (dermatology) is confirmed for Thu 3 Dec at 09:30. Please arrive 10 min early and bring your health card.", {"g": 5}),
        ("me", "Thank you, confirmed", {}),
        ("u12", "Reply CANCEL to cancel or call +351 213 000 456 to reschedule.", {}),
    ]),
    dict(id="c12", type="direct", with_="u11", last=4300, unread=1, lines=[
        ("u11", "Hi Alex! I'm Theo, talent partner at Northwind. Loved your case study on the onboarding redesign", {}),
        ("u11", "We're hiring a Lead Product Designer, fully remote, EU hours. Open to a 20-min chat?", {"a": link("https://jobs.example/northwind/lead-product-designer", "Lead Product Designer — Northwind")}),
        ("u11", "No pressure either way 🙂", {}),
    ]),
    dict(id="c13", type="group", title="Football Thursdays ⚽️", members=["u13", "u26", "u28", "u22", "u24", "u8"], last=1300, unread=0, filler=50, lines=[
        ("u13", "Thursday 20:30, pitch 3 at Estádio Universitário. Who's in?", {}),
        ("u26", "In", {}), ("u28", "In", {}), ("me", "In", {}),
        ("u8", "Out, knee", {}),
        ("u13", "We're 9, need one more!", {"g": 90}),
        ("u24", "My cousin can come", {}),
        ("u13", "Pitch is 6€ each, pay me at the pitch", {}),
        ("u13", "Great game! 7–5 for the bibs 🔥", {"a": photo("team_photo.jpg"), "x": {"🔥": ["u26", "u28", "u0", "u24"]}}),
    ]),
    dict(id="c14", type="group", title="Book club 📚", members=["u15", "u25", "u27", "u1"], last=5200, unread=0, filler=25, lines=[
        ("u15", "Next book: 'Klara and the Sun'. Meeting Sun 6 Dec, 17:00 at mine", {}),
        ("u25", "Finally something not 900 pages long", {"x": {"😂": ["u27", "u1"]}}),
        ("u27", "I'll bring wine", {}),
        ("u15", "Alex you're hosting January, don't forget 😉", {}),
    ]),
    dict(id="c15", type="group", title="Climbing crew 🧗", members=["u18", "u30", "u17"], last=2600, unread=0, filler=30, lines=[
        ("u18", "Sintra this Sunday? Forecast is dry", {}),
        ("u30", "Yes! Leaving 8:00 from Sete Rios", {}),
        ("u18", "Alex you have the second rope right?", {}),
        ("me", "Yep, and the quickdraws", {}),
    ]),
    dict(id="c16", type="direct", with_="u2", last=400, unread=1, lines=[
        ("u2", "Did you eat?", {"g": 600}),
        ("me", "Yes mom 😄", {}),
        ("u2", "Call me when you have a moment, it's about Grandma's present", {"g": 1500}),
        ("u2", "", {"a": voice(55, "Hi darling, so I thought for the present we could all make a photo album with old pictures, I'll scan them, can you do the design? You're good at that. Call me")}),
    ]),
    dict(id="c17", type="direct", with_="u7", last=180, unread=0, lines=[
        ("u7", "Off the record: do you think the empty states need illustrations or just copy?", {}),
        ("me", "Copy first, illustrations only for the first-run screens", {}),
        ("u7", "Agree. Sam wants mascots though 🙃", {}),
        ("me", "Over my dead body", {"x": {"😂": ["u7"]}}),
    ]),
    dict(id="c18", type="direct", with_="u3", last=8000, unread=0, lines=[
        ("u3", "Caught a 3kg sea bass this morning", {"a": photo("seabass.jpg")}),
        ("me", "Wow dad!! Save some for Sunday", {}),
        ("u3", "Already in the freezer 😎", {}),
    ]),
    dict(id="c19", type="direct", with_="u4", last=3100, unread=0, lines=[
        ("u4", "Mom says you're designing the album for grandma? Need old photos from me?", {}),
        ("me", "Yes, send whatever you have from the 90s", {}),
        ("u4", "", {"a": file("old_photos_1994-1999.zip", 48210)}),
        ("u4", "Also what are we doing on Friday the 27th? Greta invited me to dinner 🤔", {"e": True}),
    ]),
    dict(id="c20", type="group", title="Old school friends", members=["u28", "u34", "u24", "u32"], archived=True, last=40000, unread=0, filler=20, lines=[
        ("u34", "20 years since graduation!! Reunion in June, I'm organising", {}),
        ("u28", "I can't believe it's been 20 years", {}),
    ]),
    dict(id="c21", type="channel", title="Nova Bank", muted=True, last=50, unread=5, lines=[
        ("bank", "Card •• 4417: 3.40 € at Fábrica Coffee Roasters", {"g": 240}),
        ("bank", "Card •• 4417: 52.10 € at Continente Amoreiras", {"g": 300}),
        ("bank", "MB Way: you sent 45.00 € to Jonas Berg", {"g": 600}),
        ("bank", "Your security code is 482 913. Never share it with anyone.", {"g": 900}),
        ("bank", "Salary received: 3,240.00 €", {"g": 500}),
        ("bank", "Card •• 4417: 12.80 € at Uber Eats", {}),
    ]),
    dict(id="c22", type="channel", title="Lisbon Tech Meetups", muted=True, last=900, unread=9, filler=20, lines=[
        ("news", "📅 Design Systems Night — Thu 26 Nov, 19:00 at Second Home. Free, register below", {"a": link("https://meetups.example/ds-night", "Design Systems Night #14")}),
        ("news", "Slides from last week's talk on accessibility audits", {"a": file("a11y-audits-slides.pdf", 6120)}),
    ]),
    dict(id="c23", type="direct", with_=None, title="+351 912 000 777", last=1000, unread=1, lines=[
        ("spam", "CTT: Your parcel is held at customs. Pay 1.99 € to release it: ctt-delivery-pt.example/pay", {}),
    ]),
    dict(id="c24", type="direct", with_="u14", last=3600, unread=0, lines=[
        ("u14", "Bro you still in for the Azores? Need the 128€ for the house by Sunday", {}),
        ("me", "Yes yes, sending this weekend", {}),
    ]),
]

FILLER = {
    "c2": ["Pushed the new tokens to the repo", "Can someone review my PR?", "Standup in 5", "Who's on call this week?", "Lunch? ramen?",
           "Figma is so slow today", "Updated the board", "I'll take that ticket", "Meeting moved to 15:00", "Love this", "Agreed",
           "Let's discuss in the sync", "Thanks!", "On it", "Back from lunch", "That's a bug, not a feature 😅", "Screenshots in the thread",
           "Customer call went well", "The analytics dashboard is up", "Sprint retro tomorrow 11:00"],
    "c3": ["So excited!!", "Who has a waterproof jacket to lend?", "Hot springs at Furnas are a must", "I'm bringing the speaker",
           "Do we cook or eat out?", "Whale watching?? 🐋", "I'll make a shared spreadsheet", "Weather looks rainy but who cares",
           "Insurance anyone?", "Look at this view", "Haha yes", "Agreed 💯"],
    "c5": ["Good morning everyone ☀️", "Did you see the news?", "Love you all", "Who's coming for lunch?", "The garden is full of lemons, come get some",
           "Call me later", "Happy Sunday", "Dad fixed the gate finally", "Kate how was the trip?", "Photos from the beach",
           "Remember to take your coat, it's cold", "😂😂😂", "Miss you"],
    "c7": ["Does anyone have a ladder?", "The elevator is making a noise again", "Thanks!", "Who left the door open downstairs?",
           "Package for flat 3A is with me", "Noise from 4B after midnight 😴", "Recycling is on Tuesdays now", "Lovely, thank you",
           "Is the garage gate broken?", "Has anyone called the electrician?", "+1", "The light on the 2nd floor is out",
           "Selling a sofa, almost new, 80€", "Can we please not leave boxes in the hall", "Happy holidays neighbours!"],
    "c9": ["Shh 🤫", "She has no idea", "Balloons yes or no?", "I can bake the cake", "Sent you the money", "Great idea"],
    "c13": ["In", "Out this week", "Who has the ball?", "Running late, start without me", "Rain or not, we play", "Good game lads", "Same time next week?"],
    "c14": ["Halfway through, no spoilers!", "Chapter 12 though 😭", "Who's bringing snacks?", "Loved it", "Didn't love the ending tbh"],
    "c15": ["Gym tonight?", "Projecting the blue route", "My fingers hurt", "Beta video in the thread", "Chalk ran out", "Sent it!! 🎉"],
    "c20": ["Haha remember that?", "Happy birthday!!", "We should meet more", "Who still talks to Mr. Pereira?"],
    "c22": ["📅 New meetup announced", "🎤 Call for speakers is open", "Recording is up", "📍 Venue changed, see details"],
}


def messenger():
    people = contacts()
    pid = {p["id"]: p for p in people}
    chats, messages = [], []
    mid = 0
    for spec in CHATS:
        members = ["u0"] + (spec.get("members") or ([spec["with_"]] if spec.get("with_") else []))
        if spec["type"] == "direct" and spec.get("with_"):
            title = pid[spec["with_"]]["name"]
        else:
            title = spec["title"]
        # Senders: people in the chat, the channel itself ("bank", "news") or a stranger.
        lines = list(spec["lines"])
        pool = FILLER.get(spec["id"], [])
        speakers = [m for m in members if m != "u0"] or ["u0"]
        filler = [((R.choice(speakers) if R.random() > 0.2 or spec["type"] == "channel" else "me"), R.choice(pool), {"g": R.randint(20, 900)})
                  for _ in range(spec.get("filler", 0))] if pool else []
        if spec["type"] == "channel":
            filler = [(lines[0][0], t, o) for _, t, o in filler]
        lines = filler + lines
        # Times: back from the last message, by each line's gap.
        t = NOW - datetime.timedelta(minutes=spec["last"])
        times = [t]
        for _, _, o in reversed(lines[:-1]):
            t = t - datetime.timedelta(minutes=o.get("g", R.randint(1, 25)), seconds=R.randint(0, 59))
            times.append(t)
        times.reverse()
        ids = []
        for i, ((who, text, o), at) in enumerate(zip(lines, times)):
            mid += 1
            sender = "u0" if who == "me" else who
            if sender in ("bank", "news", "spam"):
                sender = spec["id"]  # a channel or a stranger posts as the chat itself
            m = {"id": f"m{mid}", "chat_id": spec["id"], "from": sender, "sent_at": iso(at), "text": text}
            if "a" in o:
                m["attachment"] = o["a"]
            if "r" in o:
                m["reply_to"] = ids[i - o["r"]]
            if "x" in o:
                m["reactions"] = [{"emoji": e, "users": u} for e, u in o["x"].items()]
            if o.get("e"):
                m["edited"] = True
            ids.append(m["id"])
            messages.append(m)
        unread = spec.get("unread", 0)
        # The user's own messages are read, so the unread ones are the last others' messages.
        theirs = [i for i in ids if next(x for x in messages if x["id"] == i)["from"] != "u0"]
        read_upto = ids[-1] if unread == 0 else (theirs[-unread - 1] if len(theirs) > unread else None)
        c = {"id": spec["id"], "type": spec["type"], "title": title, "members": members if spec["type"] != "channel" else ["u0"],
             "pinned": bool(spec.get("pinned")), "muted": bool(spec.get("muted")), "archived": bool(spec.get("archived")),
             "last_read_message_id": read_upto}
        if spec["type"] == "direct" and spec.get("with_"):
            c["contact_id"] = spec["with_"]
        if spec["type"] == "group":
            c["admin"] = members[1]
        chats.append(c)
    # Check the unread counts came out as specified.
    for spec, c in zip(CHATS, chats):
        mine = [m for m in messages if m["chat_id"] == c["id"]]
        idx = next((i for i, m in enumerate(mine) if m["id"] == c["last_read_message_id"]), -1)
        got = sum(1 for m in mine[idx + 1:] if m["from"] != "u0")
        assert got == spec.get("unread", 0), (c["id"], got)
    incoming = [
        {"after_s": 20, "type": "typing", "chat_id": "c1", "from": "u1", "for_s": 6},
        {"after_s": 26, "type": "message", "chat_id": "c1", "from": "u1", "text": "On my bike now 🚲 see you at 19:30 at the tasca?"},
        {"after_s": 45, "type": "message", "chat_id": "c2", "from": "u7", "text": "@alexm can you drop the final export of the empty states here before 19:00?"},
        {"after_s": 70, "type": "message", "chat_id": "c7", "from": "u20", "text": "Reminder: water OFF tomorrow 9:00–13:00 ⚠️"},
        {"after_s": 95, "type": "message", "chat_id": "c16", "from": "u2",
         "attachment": voice(42, "Alex it's mom again, did you get my message about the album? Grandma's lunch is on Sunday at one, don't be late"), "text": ""},
        {"after_s": 130, "type": "typing", "chat_id": "c3", "from": "u14", "for_s": 8},
        {"after_s": 140, "type": "message", "chat_id": "c3", "from": "u14", "text": "Flights just went up to 109€ 😬 I'm booking everyone tonight, last call @alexm @jonasb"},
        {"after_s": 180, "type": "message", "chat_id": "c21", "from": "c21", "text": "Card •• 4417: 23.80 € at Pingo Doce"},
        {"after_s": 240, "type": "message", "chat_id": "c4", "from": "u6", "text": "Thanks for today! Could we move Monday's 1:1 to 11:30?"},
        {"after_s": 300, "type": "message", "chat_id": "c23", "from": "c23", "text": "FINAL NOTICE: your parcel will be returned today. Pay now: ctt-delivery-pt.example/pay"},
    ]
    return people, chats, messages, incoming


# =====================================================================================================================
# city trip: Petya in Saint Petersburg
# =====================================================================================================================

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def hours(default, **days):
    """Opening hours by weekday: "10:30-18:00", or None when closed. default applies to the days not named."""
    out = {}
    for d in DAYS:
        h = days.get(d, default)
        out[d] = None if h is None else dict(zip(("open", "close"), h.split("-")))
    return out


# id, name, kind, area, lat, lon, price (adult ticket, ₽; 0 = free), visit minutes, indoor, hours, notes, tags
SIGHTS = [
    ("hermitage", "State Hermitage Museum (Winter Palace)", "museum", "Center", 59.9398, 30.3146, 700, 150, True,
     hours("10:30-18:00", mon=None, wed="10:30-21:00", fri="10:30-21:00"),
     "One of the largest museums in the world. Queues are long on weekends (40–60 min) and short on Friday evenings (10–15 min). Tickets online skip the queue.",
     ["art", "history", "palace", "must-see"]),
    ("general-staff", "General Staff Building (Hermitage: Impressionists)", "museum", "Center", 59.9385, 30.3185, 500, 90, True,
     hours("10:30-18:00", mon=None, wed="10:30-21:00", fri="10:30-21:00"),
     "Monet, Matisse, Picasso in a modern wing across Palace Square. Rarely a queue.", ["art", "modern"]),
    ("palace-square", "Palace Square", "sight", "Center", 59.9390, 30.3158, 0, 20, False, hours("00:00-24:00"),
     "The main square, with the Alexander Column and the Winter Palace.", ["architecture", "must-see", "photo"]),
    ("isaac", "St. Isaac's Cathedral", "cathedral", "Center", 59.9341, 30.3061, 500, 50, True,
     hours("10:30-18:00", wed=None), "The interior: malachite columns and mosaics. The colonnade is a separate ticket.", ["architecture", "history"]),
    ("isaac-colonnade", "St. Isaac's Colonnade (viewpoint)", "viewpoint", "Center", 59.9341, 30.3061, 400, 30, False,
     hours("10:30-18:00", wed="10:30-18:00"), "262 steps up for the best view over the center. Closed in heavy rain and strong wind.",
     ["view", "rooftop", "photo"]),
    ("spilled-blood", "Church of the Savior on Spilled Blood", "cathedral", "Center", 59.9400, 30.3289, 500, 40, True,
     hours("10:30-18:00", wed=None), "Onion domes outside, 7,500 m² of mosaics inside.", ["architecture", "must-see", "photo"]),
    ("kazan", "Kazan Cathedral", "cathedral", "Center", 59.9343, 30.3248, 0, 20, True, hours("07:00-20:00"),
     "A working cathedral on Nevsky with a curved colonnade. Free; modest dress.", ["architecture", "free"]),
    ("peter-paul", "Peter and Paul Fortress", "sight", "Petrogradsky", 59.9500, 30.3166, 0, 90, False, hours("06:00-21:00"),
     "Where the city began in 1703. The grounds and the beach are free; a noon cannon fires every day at 12:00.", ["history", "free", "walk"]),
    ("peter-paul-cathedral", "Peter and Paul Cathedral (tombs of the tsars)", "cathedral", "Petrogradsky", 59.9503, 30.3163, 550, 40, True,
     hours("10:00-18:00"), "Inside the fortress: the needle spire and the Romanov tombs.", ["history"]),
    ("strelka", "Spit of Vasilievsky Island (Rostral Columns)", "viewpoint", "Vasileostrovsky", 59.9440, 30.3060, 0, 20, False,
     hours("00:00-24:00"), "The classic panorama of the Neva, the fortress and the Winter Palace. Best at dusk.", ["view", "free", "photo"]),
    ("kunstkamera", "Kunstkamera", "museum", "Vasileostrovsky", 59.9415, 30.3045, 450, 75, True,
     hours("11:00-18:00", mon=None), "Peter the Great's cabinet of curiosities. Not for the squeamish.", ["history", "weird"]),
    ("new-holland", "New Holland Island", "park", "Admiralteysky", 59.9293, 30.2895, 0, 60, False, hours("09:00-22:00"),
     "An old naval island turned into a park with food stalls and a round brick courtyard. The ice rink opens on 14 Nov (500 ₽, skates included).",
     ["free", "food", "locals", "walk"]),
    ("russian-museum", "Russian Museum (Mikhailovsky Palace)", "museum", "Center", 59.9386, 30.3323, 600, 120, True,
     hours("10:00-18:00", tue=None, thu="13:00-21:00"), "The best collection of Russian art: icons to Malevich.", ["art"]),
    ("faberge", "Fabergé Museum", "museum", "Center", 59.9339, 30.3433, 750, 75, True, hours("10:00-20:45"),
     "Nine imperial Easter eggs in the Shuvalov Palace on the Fontanka.", ["art", "palace"]),
    ("yusupov", "Yusupov Palace", "museum", "Admiralteysky", 59.9294, 30.2994, 750, 75, True, hours("11:00-17:00", sun=None),
     "Where Rasputin was killed. The tour of the cellars is included.", ["history", "palace"]),
    ("mariinsky-building", "Mariinsky Theatre (outside)", "sight", "Admiralteysky", 59.9256, 30.2960, 0, 15, False, hours("00:00-24:00"),
     "The historic stage and the new glass one across the canal. Shows: see events.", ["architecture"]),
    ("erarta", "Erarta Museum of Contemporary Art", "museum", "Vasileostrovsky", 59.9318, 30.2513, 700, 120, True,
     hours("10:00-22:00", tue=None), "Five floors of contemporary Russian art, open late.", ["art", "modern"]),
    ("loft-etagi", "Loft Project Etagi", "sight", "Central", 59.9200, 30.3540, 0, 60, True, hours("09:00-23:00"),
     "A former bakery with shops, galleries and a roof terrace (300 ₽).", ["locals", "food", "rooftop"]),
    ("sevkabel", "Sevkabel Port", "sight", "Vasileostrovsky", 59.9238, 30.2408, 0, 60, False, hours("12:00-23:00"),
     "A cable factory on the gulf turned into a waterfront with food courts. Windy.", ["locals", "food", "view"]),
    ("summer-garden", "Summer Garden", "park", "Center", 59.9447, 30.3366, 0, 40, False, hours("10:00-20:00"),
     "Peter the Great's garden. From October the marble statues are in wooden winter boxes.", ["free", "walk", "history"]),
    ("mikhailovsky-garden", "Mikhailovsky Garden", "park", "Center", 59.9401, 30.3317, 0, 20, False, hours("10:00-20:00"),
     "A quiet garden behind the Russian Museum, next to the Spilled Blood.", ["free", "walk"]),
    ("smolny", "Smolny Cathedral (belfry)", "viewpoint", "Central", 59.9490, 30.3955, 400, 40, False, hours("10:30-18:00", wed=None),
     "Baroque blue-and-white cathedral; the belfry has a view east over the Neva.", ["view", "architecture"]),
    ("lavra", "Alexander Nevsky Lavra", "sight", "Central", 59.9206, 30.3884, 0, 60, False, hours("09:30-18:00"),
     "A monastery at the end of Nevsky. The grounds are free; the necropolis with Dostoevsky's and Tchaikovsky's graves is 500 ₽.",
     ["history", "free", "walk"]),
    ("kuznechny", "Kuznechny Market", "market", "Central", 59.9269, 30.3500, 0, 30, True, hours("08:00-20:00", sun="08:00-19:00"),
     "The farmers' market: pickles, honey, berries. Tastings are free if you smile.", ["food", "locals"]),
    ("dostoevsky", "Dostoevsky Memorial Museum", "museum", "Central", 59.9268, 30.3508, 350, 60, True,
     hours("11:00-18:00", mon=None, wed="13:00-20:00"), "The flat where he wrote The Brothers Karamazov.", ["history", "literature"]),
    ("pushkin-flat", "Pushkin Apartment Museum (Moika 12)", "museum", "Center", 59.9407, 30.3209, 350, 45, True,
     hours("10:30-18:00", tue=None), "Pushkin's last home, kept as it was.", ["history", "literature"]),
    ("aurora", "Cruiser Aurora", "museum", "Petrogradsky", 59.9555, 30.3378, 600, 60, True,
     hours("10:00-18:00", mon=None, tue=None), "The ship whose shot signalled the 1917 revolution.", ["history"]),
    ("mosque", "Cathedral Mosque", "sight", "Petrogradsky", 59.9550, 30.3236, 0, 15, False, hours("00:00-24:00"),
     "A turquoise dome modelled on Samarkand. View from outside.", ["architecture", "free", "photo"]),
    ("arcade", "Museum of Soviet Arcade Machines", "museum", "Center", 59.9393, 30.3240, 550, 60, True, hours("11:00-21:00"),
     "Play the 1970s–80s machines; tokens for 15 games included. Fun in the rain.", ["fun", "indoor"]),
    ("dom-knigi", "Singer House (Dom Knigi)", "sight", "Center", 59.9356, 30.3253, 0, 30, True, hours("09:00-24:00"),
     "Art Nouveau bookstore on Nevsky with a café upstairs facing the Kazan Cathedral.", ["architecture", "free", "coffee"]),
    ("eliseyev", "Eliseyev Emporium", "sight", "Center", 59.9347, 30.3394, 0, 20, True, hours("10:00-23:00"),
     "A gilded 1903 food hall. Look up, buy a chocolate, leave.", ["architecture", "free", "food"]),
    ("nevsky-walk", "Walk Nevsky Prospekt (Admiralty → Vosstaniya)", "walk", "Center", 59.9370, 30.3150, 0, 60, False, hours("00:00-24:00"),
     "4 km of the main avenue; ends at the Moskovsky railway station (59.9310, 30.3606).", ["walk", "free", "architecture"]),
    ("bank-bridge", "Bank Bridge (griffins)", "sight", "Center", 59.9310, 30.3248, 0, 10, False, hours("00:00-24:00"),
     "A tiny footbridge with golden-winged griffins on the Griboedov Canal.", ["free", "photo"]),
    ("lakhta", "Lakhta Center observation deck", "viewpoint", "Primorsky", 59.9871, 30.1776, 1200, 90, True, hours("10:00-22:00"),
     "The tallest building in Europe, 357 m deck. 45 minutes from the center; worth it only on a clear day.", ["view", "modern"]),
    ("yelagin", "Yelagin Island park", "park", "Petrogradsky", 59.9790, 30.2650, 0, 90, False, hours("06:00-24:00"),
     "A car-free island park with squirrels and a view to the gulf at the western tip.", ["walk", "free", "nature"]),
    ("botanical", "Botanical Garden greenhouses", "museum", "Petrogradsky", 59.9700, 30.3240, 450, 60, True,
     hours("11:00-17:00", mon=None), "Tropical greenhouses: warm and green when it's grey outside.", ["nature", "indoor"]),
    ("street-art-museum", "Street Art Museum", "museum", "Krasnogvardeysky", 59.9800, 30.4720, 450, 90, False, hours(None),
     "Murals in a working factory. Closed for the season (November–April).", ["art", "modern", "street-art"]),
    ("vitebsky", "Vitebsky railway station", "sight", "Central", 59.9198, 30.3290, 0, 20, True, hours("05:00-24:00"),
     "The first railway station in Russia, with an Art Nouveau interior almost nobody visits.", ["architecture", "free"]),
    ("tauride", "Tauride Garden", "park", "Central", 59.9450, 30.3720, 0, 30, False, hours("07:00-22:00"),
     "A locals' park with a pond and a greenhouse café.", ["free", "walk", "locals"]),
    ("fontanka-walk", "Fontanka embankment walk (Anichkov Bridge → Summer Garden)", "walk", "Center", 59.9330, 30.3430, 0, 40, False,
     hours("00:00-24:00"), "Palaces along the river and the horse tamers of the Anichkov Bridge.", ["walk", "free", "architecture"]),
]

FOOD = [
    # id, name, kind, area, lat, lon, average spend ₽ per person, vegetarian-friendly, hours, notes
    ("pyshki", "Pyshechnaya on Konyushennaya", "street_food", "Center", 59.9380, 30.3240, 250, True, hours("09:00-20:00"),
     "Soviet-style doughnuts (pyshki) with powdered sugar and milky coffee from a tank. A queue at lunchtime."),
    ("bulochnaya-7", "Bulochnaya No. 7", "bakery", "Central", 59.9305, 30.3600, 350, True, hours("07:30-21:00"),
     "Right by the Moskovsky station: cinnamon buns and porridge for breakfast."),
    ("green-room", "Green Room", "restaurant", "Central", 59.9312, 30.3520, 1100, True, hours("12:00-23:00"),
     "A fully vegetarian restaurant: beetroot tartare, mushroom pelmeni. Book for Friday and Saturday evenings."),
    ("rubinstein-hall", "Rubinstein Street Food Hall", "food_court", "Central", 59.9290, 30.3460, 700, True, hours("11:00-02:00"),
     "Twenty stalls on the city's bar street; open late."),
    ("stolovaya-1", "Stolovaya No. 1", "canteen", "Center", 59.9335, 30.3380, 450, True, hours("09:00-22:00"),
     "A Soviet-style canteen: soups, salads, buckwheat. Some meat-free dishes every day."),
    ("falafel-sennaya", "Falafel & Shawarma Sennaya", "street_food", "Admiralteysky", 59.9270, 30.3200, 350, True, hours("00:00-24:00"),
     "24/7. The falafel wrap is vegetarian."),
    ("dumplings-vo", "Dumpling House", "restaurant", "Vasileostrovsky", 59.9420, 30.2800, 600, True, hours("11:00-23:00"),
     "Pelmeni and vareniki, with potato and mushroom ones."),
    ("koryushka", "Koryushka Bistro", "restaurant", "Petrogradsky", 59.9490, 30.3150, 1800, False, hours("12:00-23:00"),
     "Fried smelt (koryushka) facing the Winter Palace. Not much for vegetarians."),
    ("khinkali", "Khinkali & Wine", "restaurant", "Central", 59.9450, 30.3620, 1200, True, hours("12:00-24:00"),
     "Georgian: khachapuri and mushroom khinkali."),
    ("plov", "Plov Center", "restaurant", "Central", 59.9265, 30.3505, 700, False, hours("10:00-23:00"),
     "Uzbek plov by the Kuznechny Market. Meat only."),
    ("blinnaya", "Night Blinnaya", "cafe", "Center", 59.9330, 30.3480, 400, True, hours("08:00-02:00"),
     "Russian pancakes sweet and savoury, open until 2 am."),
    ("eliseyev-cafe", "Eliseyev Café", "cafe", "Center", 59.9347, 30.3394, 900, True, hours("10:00-23:00"),
     "Pastries under gilded ceilings. Expensive coffee, good éclairs."),
    ("dom-knigi-cafe", "Singer Café (Dom Knigi)", "cafe", "Center", 59.9356, 30.3253, 500, True, hours("09:00-23:00"),
     "Window seats facing the Kazan Cathedral."),
    ("pho-petrograd", "Petrograd Pho", "restaurant", "Petrogradsky", 59.9640, 30.3120, 650, True, hours("11:00-23:00"),
     "Vietnamese, with a tofu pho."),
    ("sevkabel-food", "Sevkabel food court", "food_court", "Vasileostrovsky", 59.9238, 30.2410, 800, True, hours("12:00-23:00"),
     "Containers on the waterfront: burgers, ramen, coffee."),
    ("new-holland-market", "New Holland food market", "food_court", "Admiralteysky", 59.9293, 30.2895, 800, True, hours("10:00-22:00"),
     "Stalls in the round courtyard: dumplings, bao, mulled wine."),
    ("vegan-burger", "Plant Burger", "street_food", "Central", 59.9410, 30.3600, 650, True, hours("11:00-23:00"), "Vegan burgers and fries."),
    ("coffee-admiralty", "Coffee 22", "cafe", "Center", 59.9360, 30.3150, 300, True, hours("08:00-21:00"), "Tiny specialty coffee bar by the Admiralty."),
    ("etagi-cafe", "Etagi roof café", "cafe", "Central", 59.9200, 30.3540, 600, True, hours("12:00-23:00"), "On the roof of the Loft Project; heated tent in winter."),
    ("hostel-kitchen", "Cook it yourself (supermarket + hostel kitchen)", "self_catering", "Anywhere", None, None, 300, True, hours("08:00-23:00"),
     "A supermarket breakfast or dinner cooked in the hostel kitchen. Only if the stay has a kitchen."),
]

# Two nights: Fri 13 → Sat 14 and Sat 14 → Sun 15. Prices are per bed/room per night, Saturday dearer.
STAYS = [
    # id, name, type, area, lat, lon, Fri, Sat, rating, luggage storage (₽, None = no), kitchen, check-in, check-out, notes
    ("station-hostel", "Station Hostel", "hostel · bed in 8-bed dorm", "Central", 59.9318, 30.3590, 1100, 1400, 8.1, 0, True, "14:00", "12:00",
     "Two minutes from the Moskovsky station. Early check-in from 10:00 for 500 ₽."),
    ("nevsky-loft", "Nevsky Loft Hostel", "hostel · bed in 6-bed dorm", "Center", 59.9340, 30.3410, 1450, 1800, 9.0, 0, True, "14:00", "11:00",
     "On the Fontanka by the Anichkov Bridge. Quiet after 23:00."),
    ("capsule-hub", "Capsule Hub Sennaya", "capsule hotel · capsule", "Admiralteysky", 59.9265, 30.3200, 1700, 2100, 8.6, 0, False, "15:00", "12:00",
     "Private capsules with curtains, women's and men's floors."),
    ("vo-dorm", "Vasilievsky Dorm", "hostel · bed in 10-bed dorm", "Vasileostrovsky", 59.9425, 30.2790, 950, 1150, 7.4, None, True, "14:00", "12:00",
     "The cheapest. On Vasilievsky Island: when the bridges are up (from about 01:25) there's no way back from the center but the metro, which closes at 00:30."),
    ("petrograd-mini", "Petrograd Mini-hotel", "mini-hotel · private room", "Petrogradsky", 59.9620, 30.3120, 2900, 3400, 8.8, 0, False, "14:00", "12:00",
     "A private room with a shared bathroom. Across the bridges from the center."),
    ("fontanka-rooms", "Fontanka Rooms", "guesthouse · private double", "Center", 59.9300, 30.3400, 3600, 4200, 9.1, 0, False, "15:00", "12:00",
     "Comfortable, central, and most of the budget."),
    ("hermitage-view", "Hermitage View Hostel", "hostel · bed in 4-bed dorm", "Center", 59.9375, 30.3180, 2200, 2600, 9.3, 0, True, "15:00", "11:00",
     "Five minutes from Palace Square, small dorms."),
    ("ligovsky-budget", "Ligovsky Budget Hostel", "hostel · bed in 12-bed dorm", "Central", 59.9220, 30.3550, 800, 950, 6.9, 200, True, "13:00", "12:00",
     "Cheap and loud. Luggage storage 200 ₽ a day."),
]

EVENTS = [
    # id, title, kind, where (place id or a name with coordinates), dates [(date, start)], minutes, price ₽, notes
    ("free-walk", "Free walking tour of the center", "tour", "kazan", [("2026-11-13", "11:00"), ("2026-11-14", "11:00"), ("2026-11-15", "11:00")],
     150, 0, "Meet at the Kazan Cathedral colonnade. Free; guides expect a tip, usually 300–500 ₽. Goes ahead in the rain."),
    ("rooftop-tour", "Rooftop tour with a guide", "tour", {"name": "Liteyny Prospekt 26 (meeting point)", "lat": 59.9370, "lon": 30.3480},
     [("2026-11-13", "15:00"), ("2026-11-13", "20:00"), ("2026-11-14", "15:00"), ("2026-11-15", "15:00"), ("2026-11-15", "20:00")],
     90, 1200, "Over the roofs of the center. Cancelled in rain and strong wind (the money is refunded)."),
    ("canal-boat", "Heated boat tour of the rivers and canals", "tour", {"name": "Anichkov Bridge pier", "lat": 59.9330, "lon": 30.3430},
     [(d, t) for d in ("2026-11-13", "2026-11-14", "2026-11-15") for t in ("12:00", "14:00", "16:00", "19:00")], 60, 1100,
     "A covered, heated boat with an audio guide. Runs in any weather."),
    ("bridges-boat", "Night boat to see the bridges go up", "tour", {"name": "Admiralteyskaya embankment pier", "lat": 59.9378, "lon": 30.3080},
     [("2026-11-13", "00:50"), ("2026-11-14", "00:50")], 120, 1800,
     "Departs 00:50 the night after the date shown (i.e. 14 and 15 Nov at 00:50). Ends at 02:50 at the same pier: the bridges are up, so mind which side of the river you sleep on."),
    ("swan-lake", "Swan Lake (ballet) — Mariinsky Theatre", "performance", "mariinsky-building", [("2026-11-14", "19:00")], 180, 3500,
     "The cheapest seats are in the upper tier with a partial view; 6,500 ₽ for the stalls. Sells out."),
    ("standup", "English-language stand-up night", "performance", {"name": "Bar Ziferblat-Vibes, Rubinstein St 12", "lat": 59.9298, "lon": 30.3457},
     [("2026-11-13", "20:00")], 120, 900, "Comedians from Moscow and Petersburg. A drink is included."),
    ("jazz", "Jazz Philharmonic Hall: big band night", "concert", {"name": "Jazz Philharmonic Hall, Zagorodny Pr 27", "lat": 59.9255, "lon": 30.3405},
     [("2026-11-14", "20:00")], 120, 800, ""),
    ("organ", "Organ concert at St. Peter's Lutheran Church", "concert", {"name": "Petrikirche, Nevsky Pr 22", "lat": 59.9357, "lon": 30.3220},
     [("2026-11-15", "17:00")], 70, 700, "Bach and Buxtehude in a church that was a swimming pool in Soviet times."),
    ("ice-rink-opening", "New Holland ice rink opening night", "festival", "new-holland", [("2026-11-14", "18:00")], 180, 500,
     "DJ, mulled wine, skates included."),
    ("film-night", "Open-air film night under heaters: 'Brother' (1997)", "screening", "new-holland", [("2026-11-15", "19:00")], 100, 0,
     "Free, blankets provided. Russian with English subtitles."),
]

# The weather Petya will get. Times local (UTC+3).
WEATHER = [
    {"date": "2026-11-13", "summary": "Overcast, dry", "temp_min_c": 1, "temp_max_c": 4, "wind_ms": 6, "sunrise": "08:47", "sunset": "16:22",
     "rain": []},
    {"date": "2026-11-14", "summary": "Rain most of the day, clearing in the evening", "temp_min_c": 3, "temp_max_c": 6, "wind_ms": 11,
     "sunrise": "08:50", "sunset": "16:20", "rain": [{"from": "09:00", "to": "17:30", "intensity": "heavy"}]},
    {"date": "2026-11-15", "summary": "Clear and frosty, sun all day", "temp_min_c": -3, "temp_max_c": 1, "wind_ms": 3, "sunrise": "08:53",
     "sunset": "16:17", "rain": []},
]

# Bridges over the Neva that open at night for ships (times local). While open, nobody crosses there.
BRIDGES = [
    ("palace", "Palace Bridge", 59.9411, 30.3087, "Center ↔ Vasilievsky Island", [("01:10", "02:50"), ("03:10", "04:55")]),
    ("blagoveshchensky", "Blagoveshchensky Bridge", 59.9348, 30.2894, "Center ↔ Vasilievsky Island", [("01:25", "02:45"), ("03:10", "05:00")]),
    ("birzhevoy", "Birzhevoy Bridge", 59.9475, 30.3040, "Vasilievsky Island ↔ Petrogradsky", [("02:00", "04:55")]),
    ("tuchkov", "Tuchkov Bridge", 59.9500, 30.2870, "Vasilievsky Island ↔ Petrogradsky", [("02:00", "02:55"), ("03:35", "04:55")]),
    ("trinity", "Trinity Bridge", 59.9488, 30.3270, "Center ↔ Petrogradsky", [("01:20", "04:50")]),
    ("liteyny", "Liteyny Bridge", 59.9520, 30.3493, "Center ↔ Vyborgsky", [("01:40", "04:45")]),
    ("bolsheokhtinsky", "Bolsheokhtinsky Bridge", 59.9416, 30.4013, "Center ↔ Okhta", [("02:00", "05:00")]),
]

# A rough outline for drawing a map without tiles: river centerlines (lat, lon), west to east.
RIVERS = [
    {"name": "Neva", "points": [(59.9290, 30.2400), (59.9310, 30.2700), (59.9345, 30.2890), (59.9410, 30.3090), (59.9450, 30.3170),
                                (59.9488, 30.3270), (59.9520, 30.3490), (59.9530, 30.3700), (59.9490, 30.3950), (59.9416, 30.4013),
                                (59.9330, 30.4000), (59.9250, 30.3960)]},
    {"name": "Malaya Neva", "points": [(59.9600, 30.2400), (59.9560, 30.2650), (59.9500, 30.2870), (59.9475, 30.3040), (59.9450, 30.3080)]},
    {"name": "Bolshaya Nevka", "points": [(59.9740, 30.2600), (59.9760, 30.3000), (59.9700, 30.3300), (59.9600, 30.3380), (59.9540, 30.3420)]},
    {"name": "Fontanka", "points": [(59.9455, 30.3390), (59.9390, 30.3430), (59.9330, 30.3430), (59.9270, 30.3330), (59.9200, 30.3080),
                                    (59.9160, 30.2850), (59.9150, 30.2650)]},
    {"name": "Moika", "points": [(59.9420, 30.3330), (59.9407, 30.3209), (59.9370, 30.3110), (59.9330, 30.3000), (59.9300, 30.2860),
                                 (59.9260, 30.2780)]},
    {"name": "Griboedov Canal", "points": [(59.9400, 30.3289), (59.9343, 30.3260), (59.9310, 30.3248), (59.9270, 30.3170),
                                           (59.9240, 30.3000), (59.9230, 30.2850)]},
]

# The metro in the center. Neighbouring stations are ~3 min apart; a transfer is ~4 min; entering or leaving ~4 min.
METRO_STATIONS = [
    ("lenina", "Ploshchad Lenina", 59.9557, 30.3555), ("chernyshevskaya", "Chernyshevskaya", 59.9446, 30.3601),
    ("vosstaniya", "Ploshchad Vosstaniya", 59.9310, 30.3606), ("vladimirskaya", "Vladimirskaya", 59.9275, 30.3480),
    ("pushkinskaya", "Pushkinskaya", 59.9207, 30.3296), ("tekhnolozhka", "Tekhnologichesky Institut", 59.9165, 30.3185),
    ("baltiyskaya", "Baltiyskaya", 59.9073, 30.2997), ("petrogradskaya", "Petrogradskaya", 59.9664, 30.3114),
    ("gorkovskaya", "Gorkovskaya", 59.9561, 30.3189), ("nevsky", "Nevsky Prospekt", 59.9355, 30.3271),
    ("sennaya", "Sennaya Ploshchad", 59.9270, 30.3204), ("frunzenskaya", "Frunzenskaya", 59.9063, 30.3176),
    ("primorskaya", "Primorskaya", 59.9485, 30.2345), ("vasileostrovskaya", "Vasileostrovskaya", 59.9426, 30.2783),
    ("gostiny", "Gostiny Dvor", 59.9339, 30.3330), ("mayakovskaya", "Mayakovskaya", 59.9316, 30.3549),
    ("nevskogo", "Ploshchad Aleksandra Nevskogo", 59.9241, 30.3851), ("spasskaya", "Spasskaya", 59.9270, 30.3195),
    ("dostoevskaya", "Dostoevskaya", 59.9283, 30.3459), ("ligovsky", "Ligovsky Prospekt", 59.9208, 30.3551),
    ("novocherkasskaya", "Novocherkasskaya", 59.9293, 30.4115), ("admiralteyskaya", "Admiralteyskaya", 59.9360, 30.3149),
    ("sadovaya", "Sadovaya", 59.9268, 30.3176), ("zvenigorodskaya", "Zvenigorodskaya", 59.9223, 30.3355),
    ("obvodny", "Obvodny Kanal", 59.9146, 30.3487), ("sportivnaya", "Sportivnaya", 59.9502, 30.2884),
    ("chkalovskaya", "Chkalovskaya", 59.9610, 30.2920), ("krestovsky", "Krestovsky Ostrov", 59.9718, 30.2594),
]
METRO_LINES = [
    ("1", "Line 1 (red)", "#D6083B", ["lenina", "chernyshevskaya", "vosstaniya", "vladimirskaya", "pushkinskaya", "tekhnolozhka", "baltiyskaya"]),
    ("2", "Line 2 (blue)", "#0078C9", ["petrogradskaya", "gorkovskaya", "nevsky", "sennaya", "tekhnolozhka", "frunzenskaya"]),
    ("3", "Line 3 (green)", "#009A49", ["primorskaya", "vasileostrovskaya", "gostiny", "mayakovskaya", "nevskogo"]),
    ("4", "Line 4 (orange)", "#EA7125", ["spasskaya", "dostoevskaya", "ligovsky", "nevskogo", "novocherkasskaya"]),
    ("5", "Line 5 (purple)", "#702785", ["krestovsky", "chkalovskaya", "sportivnaya", "admiralteyskaya", "sadovaya", "zvenigorodskaya", "obvodny"]),
]
# Stations under different names that are one interchange.
METRO_TRANSFERS = [["nevsky", "gostiny"], ["vosstaniya", "mayakovskaya"], ["vladimirskaya", "dostoevskaya"],
                   ["pushkinskaya", "zvenigorodskaya"], ["sennaya", "spasskaya", "sadovaya"]]

TRAVELER = {
    "name": "Petya",
    "age": 27,
    "from": "Moscow",
    "first_time_in_city": True,
    "arrival": {"at": "2026-11-13T08:10:00+03:00", "place": "Moskovsky railway station", "lat": 59.9298, "lon": 30.3624,
                "by": "Sapsan train from Moscow"},
    "departure": {"at": "2026-11-15T22:50:00+03:00", "place": "Moskovsky railway station", "lat": 59.9298, "lon": 30.3624,
                  "be_there_by": "2026-11-15T22:30:00+03:00"},
    "budget_rub": 10000,
    "budget_covers": "everything in the city: two nights' sleep, food, tickets, tours and transport. The train is already paid.",
    "luggage": "a 12 kg backpack he doesn't want to carry around all day",
    "diet": "vegetarian (eats eggs and dairy)",
    "pace": "happy to walk up to 15 km a day; likes to sleep until 9:00 at the weekend",
    "interests": ["history", "architecture", "views from above", "local food", "good coffee"],
    "not_interested_in": ["shopping malls", "more than 2.5 hours in one museum"],
    "wishes": [
        "the Hermitage, but no more than 2.5 hours there",
        "see the bridges go up at night at least once",
        "a view over the roofs",
        "try pyshki",
        "one proper sit-down vegetarian dinner",
    ],
}

TRANSPORT = {
    "currency": "RUB",
    "metro": {"fare_rub": 90, "hours": {"open": "05:45", "close": "00:30"},
              "minutes_between_stations": 3, "minutes_per_transfer": 4, "minutes_to_enter_or_leave": 4},
    "bus": {"fare_rub": 90, "note": "Same fare as the metro; slow on Nevsky in the evening."},
    "walk": {"km_per_hour": 4.5},
    "taxi": {"base_rub": 200, "per_km_rub": 30, "night_multiplier": 1.5, "night": {"from": "00:00", "to": "06:00"},
             "note": "Can't cross the Neva while the bridges are up."},
    "left_luggage": {"place": "Moskovsky railway station", "price_rub_per_day": 350, "hours": "00:00-24:00"},
}


def trip():
    sights = [{"id": i, "name": n, "kind": k, "area": a, "lat": la, "lon": lo, "price_rub": p, "visit_min": v, "indoor": ind,
               "hours": h, "description": d, "tags": t} for i, n, k, a, la, lo, p, v, ind, h, d, t in SIGHTS]
    for s in sights:
        s["rating"] = round(R.uniform(4.3, 4.9), 1)
    food = [{"id": i, "name": n, "kind": k, "area": a, "lat": la, "lon": lo, "avg_spend_rub": p, "vegetarian_friendly": veg,
             "hours": h, "description": d} for i, n, k, a, la, lo, p, veg, h, d in FOOD]
    stays = [{"id": i, "name": n, "type": ty, "area": a, "lat": la, "lon": lo,
              "price_per_night_rub": {"2026-11-13": fri, "2026-11-14": sat}, "rating": r,
              "luggage_storage_rub": lug, "kitchen": kit, "check_in": ci, "check_out": co, "notes": nt}
             for i, n, ty, a, la, lo, fri, sat, r, lug, kit, ci, co, nt in STAYS]
    events = []
    for i, title, kind, where, dates, mins, price, notes in EVENTS:
        e = {"id": i, "title": title, "kind": kind, "sessions": [{"date": d, "start": t} for d, t in dates], "duration_min": mins,
             "price_rub": price, "notes": notes}
        if isinstance(where, str):
            e["place_id"] = where
        else:
            e["venue"] = where
        events.append(e)
    bridges = [{"id": i, "name": n, "lat": la, "lon": lo, "connects": c, "open_at_night": [{"from": a, "to": b} for a, b in w]}
               for i, n, la, lo, c, w in BRIDGES]
    city_map = {"center": {"lat": 59.9343, "lon": 30.3351}, "bounds": {"south": 59.900, "north": 59.990, "west": 30.170, "east": 30.480},
                "rivers": [{"name": r["name"], "points": [{"lat": a, "lon": b} for a, b in r["points"]]} for r in RIVERS],
                "note": "There is no map tile server in the sandbox: draw the map yourself from these coordinates."}
    metro = {"stations": [{"id": i, "name": n, "lat": la, "lon": lo} for i, n, la, lo in METRO_STATIONS],
             "lines": [{"id": i, "name": n, "color": c, "stations": s} for i, n, c, s in METRO_LINES],
             "transfers": METRO_TRANSFERS}
    ids = {s["id"] for s in sights}
    assert all(e.get("place_id", "kazan") in ids for e in events)
    st = {s[0] for s in METRO_STATIONS}
    assert all(x in st for _, _, _, line in METRO_LINES for x in line) and all(x in st for t in METRO_TRANSFERS for x in t)
    return {"traveler.json": TRAVELER, "places.json": sights, "food.json": food, "stays.json": stays, "events.json": events,
            "weather.json": WEATHER, "bridges.json": bridges, "map.json": city_map, "metro.json": metro, "transport.json": TRANSPORT}


def generate(out, task_json):
    people, chats, messages, incoming = messenger()
    for name, obj in (("me.json", ME), ("contacts.json", people), ("chats.json", chats), ("messages.json", messages),
                      ("incoming.json", incoming)):
        dump(out, "messenger", name, obj)
    last = {}
    for m in messages:
        last[m["chat_id"]] = max(last.get(m["chat_id"], ""), m["sent_at"])
    live = sorted((c for c in chats if not c["archived"]), key=lambda c: last[c["id"]], reverse=True)
    assert len({last[c["id"]] for c in live[:4]}) == 4
    task_json("messenger", 4, {"en": "Invent a messenger", "ru": "Изобрести мессенджер"},
              {"en": "Not another WhatsApp: a messenger that is genuinely more convenient. Invent it and build a working prototype.",
               "ru": "Не очередной WhatsApp, а мессенджер, которым по-настоящему удобнее пользоваться. Придумать и собрать рабочий прототип."},
              [c["title"] for c in live[:3]], kind="invent", scenarios=[
                  {"en": "You have a minute: find out what people are waiting for from you, and answer the most urgent one.",
                   "ru": "У вас минута: выясните, чего от вас ждут люди, и ответьте на самое срочное."},
                  {"en": "When exactly is the water off in the building, and how much do you owe for Kate's gift?",
                   "ru": "Когда именно в доме отключат воду и сколько вы должны за подарок Кейт?"},
                  {"en": "Reply to Sam's question about the deck in the Design team chat, quoting it, and attach a file.",
                   "ru": "Ответьте на вопрос Сэма про презентацию в чате Design team, процитировав его, и приложите файл."},
                  {"en": "Wait for new messages to arrive (about a minute after opening). Did you notice them? Can you deal with them without losing your place?",
                   "ru": "Дождитесь новых сообщений (примерно минута после открытия). Вы их заметили? Можно разобраться с ними, не потеряв, где были?"},
                  {"en": "Open it on a phone (or a narrow window): is it just as comfortable?",
                   "ru": "Откройте на телефоне (или в узком окне): так же удобно?"},
              ])
    for name, obj in trip().items():
        dump(out, "city-trip", name, obj)
    task_json("city-trip", 5, {"en": "Plan a city trip", "ru": "Спланировать поездку"},
              {"en": "Petya has 3 days and 10,000 ₽ in Saint Petersburg. Build the trip planner you'd actually trust, as close to a real product as you can.",
               "ru": "У Пети 3 дня и 10 000 ₽ на Петербург. Сделать планировщик поездки, которому веришь, — максимально близко к настоящему продукту."},
              [], kind="startup", scenarios=[
                  {"en": "Look at Petya's plan for Saturday: does it fit — everything open, enough time to get around, and what does it cost?",
                   "ru": "Посмотрите план Пети на субботу: всё сходится — всё открыто, хватает времени на дорогу, сколько это стоит?"},
                  {"en": "It's raining on Saturday. Did the plan account for it? Swap an outdoor stop for something indoors: do times and the budget update?",
                   "ru": "В субботу дождь. План это учёл? Замените что-нибудь на улице на крытое: время и бюджет пересчитались?"},
                  {"en": "Petya wants to add the ballet at the Mariinsky. What does the app say about the budget, and what does it suggest dropping?",
                   "ru": "Петя хочет добавить балет в Мариинском. Что приложение говорит про бюджет и что предлагает убрать?"},
                  {"en": "Where does Petya sleep, and how does he get back after seeing the bridges go up at night?",
                   "ru": "Где Петя ночует и как он вернётся после того, как посмотрит развод мостов?"},
                  {"en": "Open it on a phone, as if you were walking around the city with it: is it handy?",
                   "ru": "Откройте на телефоне, как будто гуляете с ним по городу: удобно?"},
              ])
    return len(messages), len(SIGHTS) + len(FOOD)
