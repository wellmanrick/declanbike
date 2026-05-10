// Game — top-level state machine and frame loop.
//
// State machine: MENU → PLAY → GAME_OVER → MENU. PAUSE is orthogonal
// (pauses the loop, doesn't change state).
//
// Composition: Game owns one of each subsystem (camera, ball, goal,
// wind, score, ui, audio, level, input). Each subsystem is told about
// its peers at construction so the frame loop can run without dipping
// into Game's internals.
import * as THREE from "three";
import { CameraController } from "./CameraController.js";
import { GoalPost } from "./GoalPost.js";
import { BallPhysics } from "./BallPhysics.js";
import { WindSystem } from "./WindSystem.js";
import { ScoreSystem } from "./ScoreSystem.js";
import { UIManager } from "./UIManager.js";
import { AudioManager } from "./AudioManager.js";
import { LevelManager } from "./LevelManager.js";
import { InputController } from "./InputController.js";
import { buildStadium } from "./Stadium.js";

export const STATE = Object.freeze({ MENU: "menu", PLAY: "play", GAME_OVER: "over" });

export class Game {
  constructor(mountEl) {
    this.mount = mountEl;
    this.state = STATE.MENU;
    this.paused = false;
    // THREE renderer + scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a1018, 70, 220);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;
    this.mount.appendChild(this.renderer.domElement);
    // Subsystems
    this.camera = new CameraController(window.innerWidth, window.innerHeight);
    this.goal = new GoalPost(this.scene);
    this.ball = new BallPhysics(this.scene);
    this.wind = new WindSystem();
    this.score = new ScoreSystem();
    this.ui = new UIManager();
    this.audio = new AudioManager();
    this.level = new LevelManager();
    this.input = new InputController(this.renderer.domElement, this);
    // Stadium scenery (lights, ground, crowd, sky)
    this.stadium = buildStadium(this.scene);
    // Game-feel state
    this.shake = 0;
    this.slowT = 0;
    // Timed mode clock (only ticks while state === PLAY in timed mode)
    this.timeLeft = 0;
    // Bind resize
    window.addEventListener("resize", () => this._onResize());
    this._onResize();
    // Loop
    this._lastT = performance.now();
    this._frame = this._frame.bind(this);
  }

  start() {
    this.ui.showMenu();
    this.state = STATE.MENU;
    requestAnimationFrame(this._frame);
  }

  startMode(mode) {
    this.audio.ensure();
    this.audio.startCrowdLoop();
    this.score.reset();
    this.level.startMode(mode);
    this.timeLeft = (mode === "timed") ? 60 : 0;
    this.state = STATE.PLAY;
    this.ui.hideMenu();
    this.ui.hideGameOver();
    this.ui.showHud();
    this._setupKick();
  }

  restart() {
    this.startMode(this.level.mode || "classic");
  }

  toMenu() {
    this.state = STATE.MENU;
    this.ball.reset();
    this.ui.hideHud();
    this.ui.hideGameOver();
    this.ui.showMenu();
    this.audio.stopCrowdLoop();
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; this._lastT = performance.now(); }

  // Configure the goal + ball for the next kick. Called at mode start
  // and after each kick is resolved.
  _setupKick() {
    this.goal.setDistance(this.level.distance);
    this.goal.setWidth(this.level.uprightsWidth);
    this.wind.randomize(this.level.windCap);
    this.ball.reset();
    this.input.armForKick();
    this.ui.updateHud(this);
  }

  // Called by InputController when the user releases a flick.
  fire(kickParams) {
    if (this.state !== STATE.PLAY || !this.ball.canFire()) return;
    this.audio.kickThump();
    this.audio.haptic(40);
    this.ball.fire(kickParams);
    this.level.consumeBall();
    this.ui.hidePower();
    this.ui.updateHud(this);
  }

  // ResolveKick — called by BallPhysics once the ball stops or leaves
  // the play volume. Decides made/missed, scoring, slow-mo, etc.
  resolveKick(outcome) {
    // outcome: { made: bool, perfect: bool, hitPost: bool, distYards: number, drift: number }
    if (outcome.made) {
      const summary = this.score.applyMadeKick({
        distance: this.level.distance,
        perfect: outcome.perfect,
        windHelp: this.wind.helped(outcome.drift),
      });
      this.audio.cheer(outcome.perfect);
      this.audio.haptic(outcome.perfect ? [0, 30, 30, 60] : [0, 25, 30, 25]);
      this.ui.flashFeedback(outcome.perfect ? "PERFECT!" : "GOOD!", outcome.perfect ? "perfect" : "");
      if (outcome.perfect) this.slowT = 0.9;
      this.level.advance(); // distance up, wind harder, etc.
    } else {
      const broke = this.score.applyMissedKick(this.level.mode);
      this.audio.groan();
      this.audio.haptic(120);
      const text = outcome.hitPost ? "POST!" : "MISS";
      this.ui.flashFeedback(text, "miss");
      if (outcome.hitPost) this.shake = 16;
      if (broke) { this._endRun(); return; }
    }
    // Out of balls in classic mode? End the run.
    if (this.level.mode === "classic" && this.level.ballsLeft <= 0) {
      this._endRun();
      return;
    }
    // Else queue up the next kick.
    setTimeout(() => {
      if (this.state === STATE.PLAY) this._setupKick();
    }, 1100);
  }

  _endRun() {
    this.state = STATE.GAME_OVER;
    this.score.commitBest(this.level.mode);
    this.ui.hideHud();
    this.ui.hidePower();
    this.audio.whistle();
    this.ui.showGameOver(this);
    this.audio.stopCrowdLoop();
  }

  _frame(now) {
    const rawDt = Math.min(0.05, (now - this._lastT) / 1000);
    this._lastT = now;
    const dt = this.paused ? 0 : (this.slowT > 0 ? rawDt * 0.30 : rawDt);
    if (this.slowT > 0) this.slowT = Math.max(0, this.slowT - rawDt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - rawDt * 60);
    if (this.state === STATE.PLAY && !this.paused) {
      // Timed-mode countdown.
      if (this.level.mode === "timed") {
        this.timeLeft -= rawDt;
        if (this.timeLeft <= 0) { this.timeLeft = 0; this._endRun(); }
      }
      this.wind.update(dt);
      this.ball.update(dt, this.wind, this.goal, this);
      this.camera.update(dt, this.ball, this.shake);
      this.input.update(this);
      this.ui.updateHud(this);
    } else {
      this.camera.idle(dt, this.shake);
    }
    this.renderer.render(this.scene, this.camera.cam);
    requestAnimationFrame(this._frame);
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.resize(w, h);
  }
}
