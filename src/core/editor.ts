import { computed, observable } from 'mobx';
import { range, inRange } from 'lodash';
import { makeNoteScale } from './tonal-utils';
import * as mm from '@magenta/music';

import { Note } from './note';

import {
  DEFAULT_NOTES,
  TOTAL_SIXTEENTHS,
  MAX_PITCH,
  MIN_PITCH,
} from './constants';

export const enum EditorTool {
  DRAW = 'DRAW',
  MASK = 'MASK',
}

export interface ScaleValue {
  value: number;
  name: string;
}

export class Mask {
  constructor(
    public topLeftValue: number,
    public topLeftPosition: number,
    public bottomRightValue: number,
    public bottomRightPosition: number
  ) {}
}

export class Editor {
  @observable private userNotesMap = new Map<string, Note>();
  @observable private agentNotesMap = new Map<string, Note>();

  @computed get userNotes() {
    return [...this.userNotesMap.values()];
  }
  @computed get agentNotes() {
    return [...this.agentNotesMap.values()];
  }

  @computed get allNotes() {
    return [...this.userNotes, ...this.agentNotes];
  }

  @observable scale = makeNoteScale(MAX_PITCH, MIN_PITCH);
  @observable activeNoteValue: number | null = null;

  @observable private currentlySelectedNotes = new Set<Note>();
  isNoteSelected = (note: Note) => {
    return this.currentlySelectedNotes.has(note);
  };

  @observable private currentlyPlayingNotes = new Set<Note>();
  private setCurrentlyPlaying(note: Note) {
    note.isPlaying = true;
    this.currentlyPlayingNotes.add(note);
  }

  clearPlayingNotes() {
    this.currentlyPlayingNotes.clear();
    this.allNotes.forEach(note => {
      note.isPlaying = false;
    });
  }

  setNotePlaying(pitch: number, position: number) {
    const key = this.makeNoteKey(pitch, position);
    const userNote = this.userNotesMap.get(key);
    const agentNote = this.agentNotesMap.get(key);
    if (userNote) this.setCurrentlyPlaying(userNote);
    if (agentNote) this.setCurrentlyPlaying(agentNote);

    // Clear all notes that are playing if the playhead has passed them
    for (const playingNote of this.currentlyPlayingNotes.values()) {
      if (playingNote.position + playingNote.duration <= position) {
        playingNote.isPlaying = false;
        this.currentlyPlayingNotes.delete(playingNote);
      }
    }
  }

  @observable totalSixteenths = TOTAL_SIXTEENTHS;
  @observable quantizeStep = 2;

  @computed get nDivisions() {
    return this.totalSixteenths / this.quantizeStep;
  }
  @computed get divisions() {
    const divisions = range(this.nDivisions);
    return divisions;
  }

  @computed get scaleMax() {
    return this.scale[0].value;
  }

  @observable selectedTool: EditorTool = EditorTool.DRAW;

  constructor() {
    let position = 0;
    DEFAULT_NOTES.forEach(([pitch, duration], i) => {
      const note = new Note(pitch, position, duration);
      position += duration;
      this.addNote(note);
    });
    this.currentlySelectedNotes.clear();
  }

  private makeNoteKey(pitch: number, position: number) {
    return `${pitch}:${position}`;
  }

  overlapsWithUserNote(pitch: number, position: number) {
    const key = this.makeNoteKey(pitch, position);
    return this.userNotesMap.has(key);
  }

  getValueFromScaleIndex(scaleIndex: number) {
    return this.scale[scaleIndex].value;
  }

  addNote(note: Note) {
    const { position, value } = note;
    const key = this.makeNoteKey(value, position);
    this.userNotesMap.set(key, note);
    this.currentlySelectedNotes.clear();
    this.currentlySelectedNotes.add(note);
  }

  addAgentNotes(sequence: mm.NoteSequence.INote[], replace = true) {
    if (replace) {
      this.clearAgentNotes();
    }
    sequence.forEach(item => {
      const position = item.quantizedStartStep;
      const duration = item.quantizedEndStep - item.quantizedStartStep;
      const voice = item.instrument;
      const note = new Note(item.pitch, position, duration, 'AGENT', voice);
      const key = this.makeNoteKey(item.pitch, position);
      this.agentNotesMap.set(key, note);
    });
  }

  clearAgentNotes() {
    this.agentNotesMap.clear();
  }

  // Resolves conflicting note edits
  endNoteDrag(note: Note) {
    for (let other of this.userNotes) {
      if (other.position === note.position && other.value === note.value) {
        const key = this.makeNoteKey(other.value, other.position);
        this.userNotesMap.delete(key);
      }
    }
  }

  private overlaps(note: Note, positionRange: number[], valueRange: number[]) {
    const { value, position, duration } = note;
    const [startPosition, endPosition] = positionRange;
    const [startValue, endValue] = valueRange;
    if (value < startValue || value > endValue) {
      return false;
    } else if (position >= startPosition && position < endPosition) {
      return true;
    } else if (
      position < startPosition &&
      position + duration > startPosition
    ) {
      return true;
    }

    return false;
  }

  maskNotes(positionRange: number[], valueRange: number[]) {
    for (const note of [...this.userNotes, ...this.agentNotes]) {
      if (this.overlaps(note, positionRange, valueRange)) {
        note.isMasked = !note.isMasked;
      }
    }
  }
}
