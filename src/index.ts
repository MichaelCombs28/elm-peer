import { Peer, DataConnection, MediaConnection } from "peerjs";
import { nanoid } from "nanoid";

export interface Storage {
  get: (id: string) => any | undefined;
  set: (id: string, data: any) => void;
  delete: (id: string) => void;
}

export class PeerPort {
  #send: (msg: PeerEvent) => void;
  #storage: Storage;
  constructor(
    send: (msg: PeerEvent) => void,
    subscribe: (fn: (msg: PeerCmd) => void) => void,
    storage?: Storage
  ) {
    this.#send = send;
    this.#storage = storage ? storage : new MapStorage();
    subscribe(this.handleMsg);
  }

  handleMsg(msg: PeerCmd) {
    const fname = msg.type.charAt(0).toLowerCase() + msg.type.slice(1);
    this[fname](msg);
  }

  subscribeToPeerEvents(peer: Peer) {
    let peerID: PeerID;
    peer.on("open", (id: PeerID) => {
      peerID = id;
      this.#storage.set(id, peer);
      this.#send({ type: "PeerOpened", peerID });
    });

    peer.on("close", () => {
      this.#storage.delete(peer.id);
      this.#send({ type: "PeerClosed", peerID });
    });

    peer.on("disconnected", (id) => {
      this.#send({ type: "PeerDisconnected", peerID: id });
    });

    peer.on("error", (err: Error) => {
      this.#send({ type: "PeerError", peerID, err });
    });

    peer.on("connection", (conn: DataConnection) => {
      this.handleDataMsg(peerID, conn);
    });

    peer.on("call", (conn: MediaConnection) => {
      this.handleMediaMsg(peerID, conn);
    });
  }

  handleDataMsg(local: PeerID, conn: DataConnection) {
    const dataID = nanoid();

    conn.on("open", () => {
      this.#storage.set(dataID, conn);
      this.#send({ type: "DataOpened", dataID, local, remote: conn.peer });
    });

    conn.on("close", () => {
      this.#send({ type: "DataClosed", dataID, local, remote: conn.peer });
    });

    conn.on("error", (err) => {
      this.#send({ type: "DataError", dataID, local, remote: conn.peer, err });
    });

    conn.on("data", (data) => {
      if (data instanceof BlobData) {
        const blobID = nanoid();
        this.#storage.set(blobID, data.data);
        this.#send({
          type: "DataReceivedBlob",
          dataID,
          blobID,
          local,
          remote: conn.peer,
          contentType: data.contentType,
        });
      } else if (data instanceof JsonData) {
        this.#send({
          type: "DataReceivedJSON",
          dataID,
          local,
          remote: conn.peer,
          data: data.data,
        });
      } else if (data instanceof String) {
        this.#send({
          type: "DataReceivedJSON",
          dataID,
          local,
          remote: conn.peer,
          data: data,
        });
      } else if (data instanceof Number) {
        this.#send({
          type: "DataReceivedJSON",
          dataID,
          local,
          remote: conn.peer,
          data: data,
        });
      } else if (data instanceof Boolean) {
        this.#send({
          type: "DataReceivedJSON",
          dataID,
          local,
          remote: conn.peer,
          data: data,
        });
      } else {
        const blobID = nanoid();
        this.#storage.set(blobID, data);
        this.#send({
          type: "DataReceivedBlob",
          dataID,
          blobID,
          local,
          remote: conn.peer,
          contentType: typeof data,
        });
      }
    });
  }

  handleMediaMsg(local: PeerID, conn: MediaConnection) {
    const mediaConnectionID = nanoid();
    this.#storage.set(mediaConnectionID, conn);

    conn.on("stream", (stream: MediaStream) => {
      const streamID = nanoid();
      this.#storage.set(streamID, stream);
      this.#send({
        type: "MediaStreamReceived",
        mediaConnectionID,
        streamID,
        local,
        remote: conn.peer,
      });
    });

    conn.on("close", () => {
      this.#send({
        type: "MediaStreamClosed",
        mediaConnectionID,
        local,
        remote: conn.peer,
      });
    });

    conn.on("error", (err: Error) => {
      this.#send({
        type: "MediaStreamError",
        mediaConnectionID,
        local,
        remote: conn.peer,
        err,
      });
    });
  }

  newPeer(data: NewPeer) {
    const peer = data.peerID ? new Peer(data.peerID) : new Peer();
    this.subscribeToPeerEvents(peer);
  }

  connectToPeer(data: ConnectToPeer) {
    const peer = this.#getPeer(data.local);
    const conn = peer.connect(data.remote);
    this.handleDataMsg(data.local, conn);
  }

  callPeer(data: CallPeer) {
    const peer: Peer = this.#getPeer(data.local);
    const stream = this.#getStream(data.streamID);
    const conn = peer.call(data.remote, stream);
    this.handleMediaMsg(data.local, conn);
  }

  reconnectToServer(data: ReconnectToServer) {
    const peer = this.#getPeer(data.peerID);
    peer.reconnect();
  }

  answerMediaConnection(data: AnswerMediaConnection) {
    const mediaConnection = this.#getMediaConnection(data.mediaConnectionID);
    if (data.streamID) {
      const stream = this.#getStream(data.streamID);
      mediaConnection.answer(stream);
      return;
    }
    mediaConnection.answer();
  }

  #getMediaConnection(mediaConnectionID: string): MediaConnection {
    const conn = this.#storage.get(mediaConnectionID);
    if (conn === undefined || !(conn instanceof MediaConnection)) {
      this.#send({
        type: "MediaConnectionDoesNotExist",
        mediaConnectionID,
      });
      throw "MediaConnectionDoesNotExist";
    }
    return conn;
  }

  #getStream(streamID: string): MediaStream {
    const stream = this.#storage.get(streamID);
    if (stream === undefined || !(stream instanceof MediaStream)) {
      this.#send({
        type: "StreamDoesNotExist",
        streamID,
      });
      throw "StreamDoesNotExist";
    }
    return stream;
  }

  #getPeer(peerID: PeerID): Peer {
    const peer: Peer = this.#storage.get(peerID);
    if (peer === undefined || !(peer instanceof Peer)) {
      this.#send({
        type: "PeerDoesNotExist",
        peerID,
      });
      throw "PeerDoesNotExist";
    }
    return peer;
  }
}

type PeerID = string;

// Events
//
type PeerEvent =
  | PeerDoesNotExist
  | PeerOpened
  | PeerDisconnected
  | PeerClosed
  | PeerError
  | DataOpened
  | DataClosed
  | DataError
  | DataReceivedJSON
  | DataReceivedBlob
  | MediaStreamReceived
  | MediaConnectionClosed
  | MediaConnectionError
  | MediaConnectionDoesNotExist
  | StreamDoesNotExist;

type PeerDoesNotExist = {
  type: "PeerDoesNotExist";
  peerID: PeerID;
};

type PeerOpened = {
  type: "PeerOpened";
  peerID: PeerID;
};

type PeerDisconnected = {
  type: "PeerDisconnected";
  peerID: PeerID;
};

type PeerClosed = {
  type: "PeerClosed";
  peerID: PeerID;
};

type PeerError = {
  type: "PeerError";
  peerID: PeerID;
  err: Error;
};

type DataOpened = {
  type: "DataOpened";
  dataID: string;
  local: PeerID;
  remote: PeerID;
};

type DataClosed = {
  type: "DataClosed";
  dataID: string;
  local: PeerID;
  remote: PeerID;
};

type DataError = {
  type: "DataError";
  dataID: string;
  local: PeerID;
  remote: PeerID;
  err: Error;
};

type DataReceivedJSON = {
  type: "DataReceivedJSON";
  dataID: string;
  local: PeerID;
  remote: PeerID;
  data: Json;
};

type DataReceivedBlob = {
  type: "DataReceivedBlob";
  dataID: string;
  local: PeerID;
  remote: PeerID;
  contentType: string;
  blobID: string;
};

type MediaStreamReceived = {
  type: "MediaStreamReceived";
  mediaConnectionID: string;
  streamID: string;
  local: PeerID;
  remote: PeerID;
};

type MediaConnectionClosed = {
  type: "MediaConnectionClosed";
  mediaConnectionID: string;
  local: PeerID;
  remote: PeerID;
};

type MediaConnectionError = {
  type: "MediaConnectionError";
  mediaConnectionID: string;
  local: PeerID;
  remote: PeerID;
  err: Error;
};

type MediaConnectionDoesNotExist = {
  type: "MediaConnectionDoesNotExist";
  mediaConnectionID: string;
};

type StreamDoesNotExist = {
  type: "StreamDoesNotExist";
  streamID: string;
};

type PeerCmd =
  | NewPeer
  | ConnectToPeer
  | CallPeer
  | ReconnectToServer
  | AnswerMediaConnection;

type NewPeer = {
  type: "NewPeer";
  peerID?: PeerID;
};

type ConnectToPeer = {
  type: "ConnectToPeer";
  local: PeerID;
  remote: PeerID;
};

type CallPeer = {
  type: "CallPeer";
  local: PeerID;
  remote: PeerID;
  streamID: string;
};

type ReconnectToServer = {
  type: "ReconnectToServer";
  peerID: PeerID;
};

type AnswerMediaConnection = {
  type: "AnswerMediaConnection";
  mediaConnectionID: string;
  streamID?: string;
};

class MapStorage {
  #map: Map<string, any> = new Map();
  get(id: string): any {
    return this.#map.get(id);
  }

  set(id: string, data: any) {
    this.#map.set(id, data);
  }

  delete(id: string) {
    this.#map.delete(id);
  }
}

type PeerMsg = JsonData | BlobData;

export class JsonData {
  _data: Json;
  get data(): Json {
    return this._data;
  }
}

export class BlobData {
  _data: any;
  get data(): any {
    return this._data;
  }

  get contentType(): string {
    return typeof this._data;
  }
}

// Helpers
type Json =
  | Array<Json>
  | { [key: string]: Json }
  | string
  | number
  | boolean
  | String
  | Number
  | Boolean
  | null;
