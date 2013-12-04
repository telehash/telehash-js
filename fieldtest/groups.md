hash-chatroom
=========

Experimental [telehash](http://telehash.org) based command-line chatroom app.

Run:
```
npm install
node chat.js room@memberhash
```

The room name can be anything and you just need to provide the hashname of any other member of the same room to join it, or leave off the "@memberhash" to create a new room.  Try 42@32663be9a07889fccd78904fcbeae820a7ebb4869af9c6a956931de91c614748 and look for me (jer).

### Protocol

The protocol used here is very simplistic, just a MVP to get basic groupchat working.  There are two basic channels used, one to get a list of members, and one to join a room and send/receive messages.

#### "members"

Create a reliable channel to any hashname of type `memebers` and include a `"room":"nameofroom"` with it, and if the receiving hashname is a member of that room, it will return one or more packets with lists of members.

To request the list (raw telehash packet, switch should set the `c` and `seq`):

```json
{
  "type":"_members",
  "_":{"room":"theroom"},
  "c":"...",
  "seq":0
}
```

The response will be a channel `err` or if successful it would look like (switch should handle `c`, `seq`, and `ack`):

```json
{
  "_":{
    "members":[
      "851042800434dd49c45299c6c3fc69ab427ec49862739b6449e1fcd77b27d3a6",
      "32663be9a07889fccd78904fcbeae820a7ebb4869af9c6a956931de91c614748"
    ]
  },
  "c":"...",
  "seq":0,
  "ack":0,
  "end":true
}
```

If multiple packets are needed because the member list is long, they are sent in sequence and the last packet will contain an `end`.

#### "chat"

To join a chatroom, create a reliable channel of type `chat` and include the same `"room":"nameofroom"` and a `"nick":"mynickname"` with it.  You must send this to every known member in a chatroom, as it's a full mesh, and each member is responsible for connecting to every other one.  If the recipient isn't part of that room it should return an `err` otherwise it returns it's nickname and the sender is then joined on that channel.

To request to join:

```json
{
  "type":"_chat",
  "_":{"room":"theroom", "nick":"jer"},
  "c":"...",
  "seq":0
}
```

A successful join:

```json
{
  "_":{"nick":"foo"},
  "c":"...",
  "seq":0,
  "ack":0
}
```

To send/receive a message (id is epoch timestamp in milliseconds):

```json
{
  "_":{"message":"hi", "id":1384734179000},
  "c":"...",
  "seq":...,
  "ack":...
}
```

To leave a room, close the channel by sending a packet with an `"end":true`.