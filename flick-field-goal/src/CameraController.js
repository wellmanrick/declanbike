// CameraController — broadcast-style camera behind the kicker.
//
// Two modes:
//   idle()   — slow drift while waiting at the menu / between kicks.
//   update() — track the ball during flight, gentle parallax. On a
//              made-kick slow-mo, the camera glides forward slightly.
//
// Screen-shake is applied as a small post-transform offset.
import * as THREE from "three";

const BASE_POS = new THREE.Vector3(0, 2.4, -7);
const BASE_LOOK = new THREE.Vector3(0, 4, 30);

export class CameraController {
  constructor(w, h) {
    this.cam = new THREE.PerspectiveCamera(58, w / h, 0.1, 400);
    this.cam.position.copy(BASE_POS);
    this.cam.lookAt(BASE_LOOK);
    this._t = 0;
    // Offsets from base position. Used by ball-follow + shake.
    this._offset = new THREE.Vector3();
    this._look = BASE_LOOK.clone();
  }

  resize(w, h) {
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }

  // Subtle drift around the base position when the ball isn't in play.
  idle(dt, shake) {
    this._t += dt;
    const sway = Math.sin(this._t * 0.3) * 0.2;
    this.cam.position.set(BASE_POS.x + sway, BASE_POS.y, BASE_POS.z);
    this._look.copy(BASE_LOOK);
    this._applyShake(shake);
    this.cam.lookAt(this._look);
  }

  // Track the ball when it's in flight. The base position stays put;
  // we just nudge the look target to follow the ball, which gives a
  // broadcast-cam feel without a swooping motion that disorients on
  // mobile.
  update(dt, ball, shake) {
    this._t += dt;
    const target = ball.thrown ? ball.position : BASE_LOOK;
    this._look.lerp(target, 0.18);
    this.cam.position.copy(BASE_POS);
    this._applyShake(shake);
    this.cam.lookAt(this._look);
  }

  _applyShake(shake) {
    if (!shake) return;
    const s = shake * 0.05;
    this.cam.position.x += (Math.random() - 0.5) * s;
    this.cam.position.y += (Math.random() - 0.5) * s;
  }
}
