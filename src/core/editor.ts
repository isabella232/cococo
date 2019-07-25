import { computed, observable } from 'mobx';
import { range } from 'lodash';
import { makeNoteScale } from './tonal-utils';
import * as _ from 'lodash';

import { Note, NoteSequence, Source, Voice } from './note';
import undo, { undoable } from './undo';

import {
  DEFAULT_NOTES,
  TOTAL_SIXTEENTHS,
  MAX_PITCH,
  MIN_PITCH,
} from './constants';
import { MinMaxNorm } from '@tensorflow/tfjs-layers/dist/constraints';

export const enum EditorTool {
  DRAW = 'DRAW',
  MASK = 'MASK',
  ERASE = 'ERASE',
}

export interface ScaleValue {
  pitch: number;
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

class Editor {
  @observable private notesMap = new Map<number, Note>();
  @observable private tempNotesMap = new Map<number, Note>();

  setTempNotes(notes: Note[], clear = true) {
    if (clear) this.tempNotesMap.clear();
    notes.forEach(note => {
      this.tempNotesMap.set(note.id, note);
    });
  }

  @computed get allNotes() {
    return [...this.notesMap.values(), ...this.tempNotes];
  }

  @computed get tempNotes() {
    return [...this.tempNotesMap.values()];
  }

  @computed get userNotes() {
    return this.allNotes.filter(note => note.source === Source.USER);
  }
  @computed get agentNotes() {
    return this.allNotes.filter(note => note.source === Source.AGENT);
  }

  @observable scale = makeNoteScale(MAX_PITCH, MIN_PITCH);
  @observable activeNoteValue: number | null = null;

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
    return this.scale[0].pitch;
  }

  @observable selectedTool: EditorTool = EditorTool.DRAW;
  @observable selectedVoice: Voice = Voice.SOPRANO;

  // Masks are maintained as an array of masked sixteenth notes, one per voice.
  @observable generationMasks: number[][] = [[], [], [], []];

  constructor() {
    let position = 0;
    DEFAULT_NOTES.forEach(([pitch, duration], i) => {
      const note = new Note(pitch, position, duration);
      position += duration;
      this._addNote(note);
    });
    this.currentlySelectedNotes.clear();
  }

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

  private getNoteByPitchPosition(pitch: number, position: number) {
    return this.allNotes.find(note => {
      return note.pitch === pitch && note.position === position;
    });
  }

  setNotePlaying(pitch: number, position: number) {
    const note = this.getNoteByPitchPosition(pitch, position);
    if (note) this.setCurrentlyPlaying(note);

    // Also set temp notes playing
    const tempNote = this.tempNotesMap.get(note.id);
    if (tempNote) this.setCurrentlyPlaying(tempNote);

    // Clear all notes that are playing if the playhead has passed them
    for (const playingNote of this.currentlyPlayingNotes.values()) {
      if (playingNote.position + playingNote.duration <= position) {
        playingNote.isPlaying = false;
        this.currentlyPlayingNotes.delete(playingNote);
      }
    }
  }

  @undoable()
  addNote(note: Note, shouldSelect = false) {
    this._addNote(note);
    if (shouldSelect) {
      this.currentlySelectedNotes.clear();
      this.currentlySelectedNotes.add(note);
    }
  }

  // The non-undoable internal method
  private _addNote(note: Note) {
    this.notesMap.set(note.id, note);
  }

  @undoable()
  removeNote(note: Note) {
    this.removeNote(note);
  }

  // The non-undoable internal method
  private _removeNote(note: Note) {
    this.notesMap.delete(note.id);
  }

  removeCandidateNoteSequence(notes: Note[]) {
    notes.forEach(note => this._removeNote(note));
  }

  getValueFromScaleIndex(scaleIndex: number) {
    return this.scale[scaleIndex].pitch;
  }

  @undoable()
  addAgentNotes(sequence: NoteSequence, replace = true) {
    if (replace) {
      this.clearAgentNotes();
    }
    sequence.forEach(note => {
      this._addNote(note);
    });
  }

  @undoable()
  clearAgentNotes() {
    for (const [key, note] of this.notesMap.entries()) {
      if (note.source === Source.AGENT) {
        this.notesMap.delete(key);
      }
    }
  }

  @undoable()
  clearAllNotes() {
    this.notesMap.clear();
  }

  startNoteDrag() {
    undo.beginUndoable();
  }

  // Resolves conflicting note edits
  endNoteDrag(note: Note) {
    for (let other of this.allNotes) {
      if (other === note) continue;
      if (other.position === note.position && other.pitch === note.pitch) {
        this.notesMap.delete(note.id);
      }
    }
    undo.completeUndoable();
  }

  // Not an undoable function because this is what is used by the undo manager.
  replaceAllNotes(notes: Note[]) {
    this.notesMap.clear();
    for (const note of notes) {
      this._addNote(note);
    }
  }

  private overlaps(note: Note, positionRange: number[], pitchRange: number[]) {
    const { pitch: pitch, position, duration } = note;
    const [startPosition, endPosition] = positionRange;
    const [startValue, endValue] = pitchRange;
    if (pitch < startValue || pitch > endValue) {
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

  private replaceNoteWithNotes(note: Note, otherNotes: Note[]) {
    this.removeNote(note);
    otherNotes.forEach(otherNote => this._addNote(otherNote));
  }

  trimOverlappingVoices(note: Note) {
    const range = [note.start, note.end];
    const overlappingNotes = this.allNotes.filter(
      otherNote =>
        otherNote !== note &&
        otherNote.voice === note.voice &&
        this.overlaps(otherNote, range, [MIN_PITCH, MAX_PITCH])
    );

    overlappingNotes.forEach(otherNote => {
      if (otherNote.end > note.end) {
        otherNote.moveStart(note.end);
      } else {
        // otherNote.isPlaying = true;
        this._removeNote(otherNote);
      }
    });
  }

  @undoable()
  maskNotes(positionRange: number[], pitchRange: number[]) {
    const notesInMask: Note[] = [];
    for (const note of this.allNotes) {
      if (this.overlaps(note, positionRange, pitchRange)) {
        notesInMask.push(note);
      }
    }

    const maskSetsByVoice = _.range(4).map(() => new Set<number>());
    notesInMask.forEach(note => {
      const maskStart = Math.max(positionRange[0], note.start);
      const maskEnd = Math.min(positionRange[1], note.end);
      const maskRange = _.range(maskStart, maskEnd);

      this.addMask(note.voice, maskRange);
    });
  }

  addMask(voiceIndex: number, mask: number[]) {
    const maskSet = new Set<number>(this.generationMasks[voiceIndex]);
    mask.forEach(maskIndex => maskSet.add(maskIndex));
    this.generationMasks[voiceIndex] = [...maskSet.values()].sort(
      (a, b) => a - b
    );
  }

  removeMask(voiceIndex: number, mask: number[]) {
    const maskSet = new Set<number>(this.generationMasks[voiceIndex]);
    mask.forEach(maskIndex => maskSet.delete(maskIndex));
    this.generationMasks[voiceIndex] = [...maskSet.values()].sort(
      (a, b) => a - b
    );
  }

  isNoteMasked(note: Note) {
    const { voice, start, end } = note;
    const mask = this.generationMasks[voice];

    for (let maskIndex of mask) {
      if (maskIndex >= start && maskIndex < end) return true;
    }
    return false;
  }

  getMaskedSequence() {
    const notes = this.allNotes;
    const maskedSequence: NoteSequence = [];

    for (const note of notes) {
      if (this.isNoteMasked(note)) maskedSequence.push(note);
    }

    return maskedSequence;
  }

  // The following logic is the old, note-based way of applying generation
  // masks. Since we're now using the maskLane approach, we'll
  @undoable()
  private maskNotesLegacy(positionRange: number[], pitchRange: number[]) {
    // If all notes in the mask are already masked, unmask them
    var allNotesAlreadyMasked = true;
    var notesInMask = [];
    for (const note of this.allNotes) {
      if (this.overlaps(note, positionRange, pitchRange)) {
        const [maskStart, maskEnd] = positionRange;
        const noteStart = note.position;
        const noteEnd = note.end;

        // Mask doesn't cover full note
        if (noteStart < maskStart || noteEnd > maskEnd) {
          allNotesAlreadyMasked = false;
        } else if (!note.isMasked) {
          allNotesAlreadyMasked = false;
        }
        notesInMask.push(note);
      }
    }
    if (allNotesAlreadyMasked) {
      notesInMask.map(function(note) {
        note.isMasked = false;
      });
      return;
    }

    // If not all notes are already masked, do the usual masking
    for (const note of this.allNotes) {
      if (this.overlaps(note, positionRange, pitchRange)) {
        // Split any notes that overlap the range, then set the overlapping portion to be masked.
        const [maskStart, maskEnd] = positionRange;
        const noteStart = note.position;
        const noteEnd = note.end;

        // Mask covers all of note
        if (noteStart >= maskStart && noteEnd <= maskEnd) {
          note.isMasked = true;
        } else if (noteStart >= maskStart && noteEnd > maskEnd) {
          const a = Note.fromNote(note).moveEnd(maskEnd);
          const b = Note.fromNote(note).moveStart(maskEnd);
          a.isMasked = true;
          this.replaceNoteWithNotes(note, [a, b]);
        } else if (noteStart < maskStart && noteEnd <= maskEnd) {
          const a = Note.fromNote(note).moveEnd(maskStart);
          const b = Note.fromNote(note).moveStart(maskStart);
          b.isMasked = true;
          this.replaceNoteWithNotes(note, [a, b]);
        } else if (noteStart < maskStart && noteEnd > maskEnd) {
          const a = Note.fromNote(note).moveEnd(maskStart);
          const b = Note.fromNote(note)
            .moveStart(maskStart)
            .moveEnd(maskEnd);
          const c = Note.fromNote(note).moveStart(maskEnd);
          b.isMasked = true;
          this.replaceNoteWithNotes(note, [a, b, c]);
        }
      }
    }
  }
}

export default new Editor();
