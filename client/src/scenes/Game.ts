import Phaser from 'phaser';

// Animations and Utils
import { createCharacterAnims } from '../anims/CharacterAnims';

// Items
import Item from '../items/Item';
import Chair from '../items/Chair';
import ComputerItem from '../items/Computer';
import Whiteboard from '../items/Whiteboard';
import VendingMachine from '../items/VendingMachine';

// Characters
import '../characters/MyPlayer';
import '../characters/OtherPlayer';
import MyPlayer from '../characters/MyPlayer';
import OtherPlayer from '../characters/OtherPlayer';
import PlayerSelector from '../characters/PlayerSelector';

// Services and Types
import Network from '../services/Network';
import { IPlayer } from '../../../types/IOfficeState';
import { PlayerBehavior } from '../../../types/PlayerBehavior';
import { ItemType } from '../../../types/Items';

// Store and State
import store from '../stores';
import { setFocused, setShowChat } from '../stores/ChatStore';
import { NavKeys, Keyboard } from '../../../types/KeyboardState';

// Events
import { Event, phaserEvents } from '../events/EventCenter';

// Configuration
const PROXIMITY_THRESHOLD = 120;
const VIDEO_START_DELAY = 500;

// Conference zone – set based on the logged player positions
const CONFERENCE_ZONE = {
  x: 200,
  y: 488,
  width: 400,
  height: 256,
};

export default class Game extends Phaser.Scene {
  network!: Network;
  private cursors!: NavKeys;
  private keyE!: Phaser.Input.Keyboard.Key;
  private keyR!: Phaser.Input.Keyboard.Key;
  private map!: Phaser.Tilemaps.Tilemap;
  myPlayer!: MyPlayer;
  private playerSelector!: Phaser.GameObjects.Zone;
  private otherPlayers!: Phaser.Physics.Arcade.Group;
  private otherPlayerMap = new Map<string, OtherPlayer>();
  
  computerMap = new Map<string, ComputerItem>();
  public whiteboardMap = new Map<string, Whiteboard>();
  public chairMap = new Map<string, Chair>();

  private nearbyPlayerIds = new Set<string>();
  private pendingProximityIds = new Set<string>(); // Users to connect after local video is ready
  private connectedZoneUsers = new Set<string>(); // Track zone users already connected to (dedup optimization)
  private lastConferenceCallTime = 0;
  private conferenceCallThrottleMs = 500; // Throttle zone connection attempts to every 500ms
  private isInConferenceZone = false;
  private zoneUsers = new Set<string>();
  private isStartingVideo = false;
  private videoStartTimeout: NodeJS.Timeout | null = null;

  constructor() {
    super('game');
  }

  registerKeys() {
    this.cursors = {
      ...this.input.keyboard.createCursorKeys(),
      ...(this.input.keyboard.addKeys('W,S,A,D') as Keyboard),
    };
    this.keyE = this.input.keyboard.addKey('E');
    this.keyR = this.input.keyboard.addKey('R');
    this.input.keyboard.disableGlobalCapture();
    this.input.keyboard.on('keydown-ENTER', () => {
      store.dispatch(setShowChat(true));
      store.dispatch(setFocused(true));
    });
    this.input.keyboard.on('keydown-ESC', () => {
      store.dispatch(setShowChat(false));
    });
  }

  disableKeys() { this.input.keyboard.enabled = false; }
  enableKeys() { this.input.keyboard.enabled = true; }

  create(data: { network: Network }) {
    if (!data.network) throw new Error('server instance missing');
    this.network = data.network;

    createCharacterAnims(this.anims);

    // 1. TILEMAP SETUP
    this.map = this.make.tilemap({ key: 'tilemap' });
    const FloorAndGround = this.map.addTilesetImage('FloorAndGround', 'tiles_wall');
    const groundLayer = this.map.createLayer('Ground', FloorAndGround);
    groundLayer.setCollisionByProperty({ collides: true });

    // 2. PLAYER SETUP
    this.myPlayer = this.add.myPlayer(705, 500, 'adam', this.network.mySessionId);
    this.playerSelector = new PlayerSelector(this, 0, 0, 16, 16);

    // 3. ITEMS IMPORT FROM TILED
    // Chairs
    const chairs = this.physics.add.staticGroup({ classType: Chair });
    const chairLayer = this.map.getObjectLayer('Chair');
    chairLayer.objects.forEach((chairObj, index) => {
      const item = this.addObjectFromTiled(chairs, chairObj, 'chairs', 'chair') as Chair;
      item.itemDirection = chairObj.properties[0].value;
      const id = `chair_${index}`;
      item.id = id;
      this.chairMap.set(id, item);
    });

    // Computers
    const computers = this.physics.add.staticGroup({ classType: ComputerItem });
    const computerLayer = this.map.getObjectLayer('Computer');
    computerLayer.objects.forEach((obj, i) => {
      const item = this.addObjectFromTiled(computers, obj, 'computers', 'computer') as ComputerItem;
      item.setDepth(item.y + item.height * 0.27);
      const id = `${i}`;
      item.id = id;
      this.computerMap.set(id, item);
    });

    // Whiteboards
    const whiteboards = this.physics.add.staticGroup({ classType: Whiteboard });
    const whiteboardLayer = this.map.getObjectLayer('Whiteboard');
    whiteboardLayer.objects.forEach((obj, i) => {
      const item = this.addObjectFromTiled(whiteboards, obj, 'whiteboards', 'whiteboard') as Whiteboard;
      const id = `${i}`;
      item.id = id;
      this.whiteboardMap.set(id, item);
    });

    // Vending machines
    const vendingMachines = this.physics.add.staticGroup({ classType: VendingMachine });
    const vendingMachineLayer = this.map.getObjectLayer('VendingMachine');
    vendingMachineLayer.objects.forEach((obj) => {
      this.addObjectFromTiled(vendingMachines, obj, 'vendingmachines', 'vendingmachine');
    });

    // 4. DECORATIVE/COLLISION LAYERS
    this.addGroupFromTiled('Wall', 'tiles_wall', 'FloorAndGround', false);
    this.addGroupFromTiled('Objects', 'office', 'Modern_Office_Black_Shadow', false);
    this.addGroupFromTiled('ObjectsOnCollide', 'office', 'Modern_Office_Black_Shadow', true);
    this.addGroupFromTiled('GenericObjects', 'generic', 'Generic', false);
    this.addGroupFromTiled('GenericObjectsOnCollide', 'generic', 'Generic', true);
    this.addGroupFromTiled('Basement', 'basement', 'Basement', true);

    this.otherPlayers = this.physics.add.group({ classType: OtherPlayer });

    // 5. CAMERA & PHYSICS
    this.cameras.main.zoom = 1.5;
    this.cameras.main.startFollow(this.myPlayer, true);

    this.physics.add.collider([this.myPlayer, this.myPlayer.playerContainer], groundLayer);
    this.physics.add.collider([this.myPlayer, this.myPlayer.playerContainer], vendingMachines);

    this.physics.add.overlap(
      this.playerSelector,
      [chairs, computers, whiteboards, vendingMachines],
      this.handleItemSelectorOverlap,
      undefined,
      this
    );

    // 6. NETWORK EVENT LISTENERS
    this.network.onPlayerJoined(this.handlePlayerJoined, this);
    this.network.onPlayerLeft(this.handlePlayerLeft, this);
    this.network.onMyPlayerReady(this.handleMyPlayerReady, this);
    this.network.onMyPlayerVideoConnected(this.handleMyVideoConnected, this);
    this.network.onPlayerUpdated(this.handlePlayerUpdated, this);
    this.network.onItemUserAdded(this.handleItemUserAdded, this);
    this.network.onItemUserRemoved(this.handleItemUserRemoved, this);
    this.network.onChatMessageAdded(this.handleChatMessageAdded, this);

    // Listen for other players entering/exiting the conference zone
    phaserEvents.on('conference-zone-update', this.onZoneUpdate, this);

    // Listen for local stream events from WebRTC
    if (this.network.webRTC) {
      this.network.webRTC.on('local-stream', (stream: MediaStream) => {
        this.isStartingVideo = false;
        if (this.videoStartTimeout) {
          clearTimeout(this.videoStartTimeout);
          this.videoStartTimeout = null;
        }
        this.myPlayer.videoConnected = true;
        console.log('✅ Local stream ready');

        // Connect to any pending proximity players
        this.pendingProximityIds.forEach(userId => {
          if (!this.nearbyPlayerIds.has(userId)) {
            const other = this.otherPlayerMap.get(userId);
            if (other) {
              const distance = Phaser.Math.Distance.Between(this.myPlayer.x, this.myPlayer.y, other.x, other.y);
              if (distance < PROXIMITY_THRESHOLD) {
                this.network.webRTC?.connectToNewUser(userId);
                this.nearbyPlayerIds.add(userId);
              }
            }
          }
        });
        this.pendingProximityIds.clear();

        // If we are in the conference zone, connect to all zone users
        if (this.isInConferenceZone) {
          this.manageConferenceCalls();
        }
      });

      this.network.webRTC.on('local-stream-error', (err: Error) => {
        this.isStartingVideo = false;
        if (this.videoStartTimeout) {
          clearTimeout(this.videoStartTimeout);
          this.videoStartTimeout = null;
        }
        console.error('❌ Failed to get local stream:', err);
      });
    }
  }

  // ---- Automatic Video Control ----
  private startLocalVideo() {
    if (this.isStartingVideo || !this.network.webRTC || this.myPlayer.videoConnected) return;
    this.isStartingVideo = true;
    this.network.webRTC.getUserMedia();
  }

  private stopLocalVideo() {
    if (!this.network || !this.network.webRTC || !this.myPlayer.videoConnected) return;

    // Close all remote connections and emit events
    for (const userId of this.zoneUsers) {
      this.closePeerConnectionAndNotify(userId);
    }
    for (const userId of this.nearbyPlayerIds) {
      this.closePeerConnectionAndNotify(userId);
    }

    // Stop local stream – WebRTC class provides this method
    try {
      if (typeof this.network.webRTC.stopLocalStream === 'function') {
        this.network.webRTC.stopLocalStream();
        console.log('✅ Local stream stopped');
      } else {
        console.warn('⚠️ stopLocalStream is not a function on webRTC object');
      }
    } catch (err) {
      console.error('❌ Error stopping local stream:', err);
    }

    this.myPlayer.videoConnected = false;
    console.log('🛑 Local video stopped automatically');
  }

  private closePeerConnectionAndNotify(userId: string) {
    if (this.network.webRTC) {
      this.network.webRTC.closePeerConnection(userId);
      phaserEvents.emit('peer-closed', userId);
    }
  }

  // ---- Conference Zone Methods ----
  private onZoneUpdate = ({ userId, inZone }: { userId: string; inZone: boolean }) => {
    if (userId === this.network.mySessionId) return;

    if (inZone) {
      this.zoneUsers.add(userId);
      console.log(`➕ User ${userId} entered conference zone. Zone users: ${Array.from(this.zoneUsers).join(', ')}`);
    } else {
      this.zoneUsers.delete(userId);
      this.connectedZoneUsers.delete(userId); // Clean up dedup tracking
      console.log(`➖ User ${userId} left conference zone. Zone users: ${Array.from(this.zoneUsers).join(', ')}`);
      if (this.isInConferenceZone && this.network.webRTC) {
        this.closePeerConnectionAndNotify(userId);
        console.log(`Closed connection to ${userId}`);
      }
    }

    if (this.isInConferenceZone) {
      this.manageConferenceCalls();
    }
  };

  private manageConferenceCalls() {
    if (!this.isInConferenceZone || !this.network.webRTC || !this.myPlayer.videoConnected) return;
    
    // Throttle to avoid 60fps consecutive calls
    const now = Date.now();
    if (now - this.lastConferenceCallTime < this.conferenceCallThrottleMs) {
      return;
    }
    this.lastConferenceCallTime = now;

    const webRTC = this.network.webRTC;
    for (const userId of this.zoneUsers) {
      if (userId === this.network.mySessionId) continue;
      
      // Only call if not already connected in this zone session
      if (!this.connectedZoneUsers.has(userId)) {
        webRTC.connectToNewUser(userId);
        this.connectedZoneUsers.add(userId);
        console.log(`📡 Zone connect to ${userId} (throttled)`);
      }
    }
  }

  // ---- Proximity Methods ----
  private checkProximityAndManageCalls() {
    if (this.isInConferenceZone) return;
    if (!this.network || !this.network.webRTC) return;

    const webRTC = this.network.webRTC;
    const myX = this.myPlayer.x;
    const myY = this.myPlayer.y;

    let anyNearby = false;

    this.otherPlayerMap.forEach((otherPlayer, id) => {
      const distance = Phaser.Math.Distance.Between(myX, myY, otherPlayer.x, otherPlayer.y);
      const isNearby = distance < PROXIMITY_THRESHOLD;
      const wasNearby = this.nearbyPlayerIds.has(id);

      if (isNearby && !wasNearby) {
        // New nearby player - only connect once when detected
        if (this.myPlayer.videoConnected) {
          webRTC.connectToNewUser(id);
          this.nearbyPlayerIds.add(id);
          console.log(`📞 Proximity connect to ${id}`);
        } else {
          // Video not ready yet – add to pending list  
          this.pendingProximityIds.add(id);
          console.log(`⏳ Pending proximity connect to ${id}`);
        }
        anyNearby = true;
      } else if (!isNearby && wasNearby) {
        this.closePeerConnectionAndNotify(id);
        this.nearbyPlayerIds.delete(id);
        this.pendingProximityIds.delete(id);
        console.log(`📴 Proximity disconnect from ${id}`);
      } else if (isNearby) {
        anyNearby = true;
      }
    });

    if (anyNearby && !this.myPlayer.videoConnected) {
      if (!this.videoStartTimeout) {
        this.videoStartTimeout = setTimeout(() => {
          this.startLocalVideo();
          this.videoStartTimeout = null;
        }, VIDEO_START_DELAY);
      }
    } else if (!anyNearby && this.myPlayer.videoConnected && !this.isInConferenceZone) {
      if (this.videoStartTimeout) {
        clearTimeout(this.videoStartTimeout);
        this.videoStartTimeout = null;
      }
      this.stopLocalVideo();
    }
  }

  // ---- Original Methods (unchanged) ----
  private handleItemSelectorOverlap(playerSelector, selectionItem) {
    const currentItem = playerSelector.selectedItem as Item;
    if (currentItem) {
      if (currentItem === selectionItem || currentItem.depth >= selectionItem.depth) return;
      if (this.myPlayer.playerBehavior !== PlayerBehavior.SITTING) currentItem.clearDialogBox();
    }
    playerSelector.selectedItem = selectionItem;
    selectionItem.onOverlapDialog();
  }

  private addObjectFromTiled(
    group: Phaser.Physics.Arcade.StaticGroup,
    object: Phaser.Types.Tilemaps.TiledObject,
    key: string,
    tilesetName: string
  ) {
    const actualX = object.x! + object.width! * 0.5;
    const actualY = object.y! - object.height! * 0.5;
    const obj = group.get(actualX, actualY, key, object.gid! - this.map.getTileset(tilesetName).firstgid);
    obj.setDepth(actualY);
    return obj;
  }

  private addGroupFromTiled(
    objectLayerName: string,
    key: string,
    tilesetName: string,
    collidable: boolean
  ) {
    const group = this.physics.add.staticGroup();
    const objectLayer = this.map.getObjectLayer(objectLayerName);
    objectLayer.objects.forEach((object) => {
      const actualX = object.x! + object.width! * 0.5;
      const actualY = object.y! - object.height! * 0.5;
      group.get(actualX, actualY, key, object.gid! - this.map.getTileset(tilesetName).firstgid).setDepth(actualY);
    });
    if (this.myPlayer && collidable)
      this.physics.add.collider([this.myPlayer, this.myPlayer.playerContainer], group);
  }

  private handlePlayerJoined(newPlayer: IPlayer, id: string) {
    const otherPlayer = this.add.otherPlayer(newPlayer.x, newPlayer.y, 'adam', id, newPlayer.name);
    this.otherPlayers.add(otherPlayer);
    this.otherPlayerMap.set(id, otherPlayer);
  }

  private handlePlayerLeft(id: string) {
    if (this.nearbyPlayerIds.has(id)) {
      this.nearbyPlayerIds.delete(id);
      if (this.network?.webRTC) {
        this.closePeerConnectionAndNotify(id);
        phaserEvents.emit(Event.PLAYER_DISCONNECTED, id);
      }
    }
    this.pendingProximityIds.delete(id);

    if (this.zoneUsers.has(id)) {
      this.zoneUsers.delete(id);
      if (this.isInConferenceZone && this.network?.webRTC) {
        this.closePeerConnectionAndNotify(id);
      }
    }

    if (this.otherPlayerMap.has(id)) {
      const otherPlayer = this.otherPlayerMap.get(id);
      if (!otherPlayer) return;
      this.otherPlayers.remove(otherPlayer, true, true);
      this.otherPlayerMap.delete(id);
    }
  }

  private handleMyPlayerReady() { this.myPlayer.readyToConnect = true; }
  private handleMyVideoConnected() { this.myPlayer.videoConnected = true; }
  private handlePlayerUpdated(field: string, value: number | string, id: string) {
    this.otherPlayerMap.get(id)?.updateOtherPlayer(field, value);
  }
  private handleItemUserAdded(playerId: string, itemId: string, itemType: ItemType) {
    if (itemType === ItemType.COMPUTER) this.computerMap.get(itemId)?.addCurrentUser(playerId);
    else if (itemType === ItemType.WHITEBOARD) this.whiteboardMap.get(itemId)?.addCurrentUser(playerId);
    else if (itemType === ItemType.CHAIR) this.chairMap.get(itemId)?.addCurrentUser(playerId);
  }
  private handleItemUserRemoved(playerId: string, itemId: string, itemType: ItemType) {
    if (itemType === ItemType.COMPUTER) this.computerMap.get(itemId)?.removeCurrentUser(playerId);
    else if (itemType === ItemType.WHITEBOARD) this.whiteboardMap.get(itemId)?.removeCurrentUser(playerId);
    else if (itemType === ItemType.CHAIR) this.chairMap.get(itemId)?.removeCurrentUser(playerId);
  }
  private handleChatMessageAdded(playerId: string, content: string) {
    this.otherPlayerMap.get(playerId)?.updateDialogBubble(content);
  }

  update(t: number, dt: number) {
    if (this.myPlayer && this.network) {
      this.playerSelector.update(this.myPlayer, this.cursors);
      this.myPlayer.update(this.playerSelector, this.cursors, this.keyE, this.keyR, this.network);
      this.checkProximityAndManageCalls();

      // ---------- Conference Zone Detection ----------
      const inZone = Phaser.Geom.Rectangle.Contains(
        new Phaser.Geom.Rectangle(CONFERENCE_ZONE.x, CONFERENCE_ZONE.y, CONFERENCE_ZONE.width, CONFERENCE_ZONE.height),
        this.myPlayer.x,
        this.myPlayer.y
      );

      if (inZone && !this.isInConferenceZone) {
        this.isInConferenceZone = true;
        console.log('✅ Entered conference zone');
        this.network.sendConferenceZoneStatus(true);
        if (!this.myPlayer.videoConnected) {
          if (this.videoStartTimeout) {
            clearTimeout(this.videoStartTimeout);
            this.videoStartTimeout = null;
          }
          this.startLocalVideo();
        }
        this.manageConferenceCalls();
      } else if (!inZone && this.isInConferenceZone) {
        this.isInConferenceZone = false;
        console.log('❌ Left conference zone');
        this.network.sendConferenceZoneStatus(false);
        for (const userId of this.zoneUsers) {
          this.closePeerConnectionAndNotify(userId);
        }
        this.zoneUsers.clear();
        this.connectedZoneUsers.clear(); // Clean up zone connection tracking
        if (this.nearbyPlayerIds.size === 0 && this.myPlayer.videoConnected) {
          if (this.videoStartTimeout) {
            clearTimeout(this.videoStartTimeout);
            this.videoStartTimeout = null;
          }
          this.stopLocalVideo();
        }
      }
    }
  }
}