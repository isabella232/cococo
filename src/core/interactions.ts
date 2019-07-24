import React from 'react';
import _ from 'lodash';
import { observable } from 'mobx';
import { EditorTool, Note, editor, engine, layout } from './index';
import { MAX_PITCH, MIN_PITCH } from './constants';

function quantizePosition(position: number, fn = Math.round) {
  return fn(position / editor.quantizeStep) * editor.quantizeStep;
}

function clampPosition(position: number) {
  return _.clamp(position, editor.totalSixteenths - 1);
}

function clampLoopPosition(postion: number) {
  return _.clamp(postion, 0, editor.totalSixteenths);
}

function clampPitch(pitch: number) {
  return _.clamp(pitch, MIN_PITCH, MAX_PITCH);
}

class Interactions {
  private noteDragStartX = 0;
  private noteDragStartY = 0;
  private noteDragStartPosition = 0;
  private noteDragStartPitch = 0;

  private loopStartDragStartX = 0;
  private loopEndDragStartX = 0;
  private loopStartDragStartPosition = 0;
  private loopEndDragStartPosition = 0;

  handleNoteHover = (note: Note) => (e: React.MouseEvent) => {
    if (this.isEraseToolDragging) {
      editor.removeNote(note);
    }
  };

  private handleNoteDrag = (note: Note) => (e: MouseEvent) => {
    const deltaX = e.clientX - this.noteDragStartX;
    const deltaY = e.clientY - this.noteDragStartY;

    const deltaPosition = Math.floor(deltaX / layout.sixteenthWidth);
    const deltaPitch = Math.floor(deltaY / layout.noteHeight);

    const deltaQuantized = quantizePosition(deltaPosition);
    const nextPosition = clampPosition(
      this.noteDragStartPosition + deltaQuantized
    );
    const nextValue = clampPitch(this.noteDragStartPitch - deltaPitch);

    if (nextPosition !== note.position || nextValue !== note.pitch) {
      note.position = nextPosition;
      note.pitch = nextValue;
      engine.playNote(note);
    }
  };

  private handleEditNoteDrag = (note: Note) => (e: MouseEvent) => {
    editor.removeNote(note);
  };

  handleNoteMouseDown = (note: Note) => (e: React.MouseEvent) => {
    editor.startNoteDrag();
    e.preventDefault();

    this.noteDragStartX = e.clientX;
    this.noteDragStartY = e.clientY;
    this.noteDragStartPosition = note.position;
    this.noteDragStartPitch = note.pitch;

    const mouseMove = this.handleNoteDrag(note);
    const mouseUp = () => {
      editor.endNoteDrag(note);
      document.removeEventListener('mousemove', mouseMove);
      document.removeEventListener('mouseup', mouseUp);
    };
    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('mouseup', mouseUp);
  };

  private handleLoopStartDrag = (e: MouseEvent) => {
    const deltaX = e.clientX - this.loopStartDragStartX;

    const deltaPosition = Math.floor(deltaX / layout.sixteenthWidth);

    const deltaQuantized = quantizePosition(deltaPosition);
    const nextPosition = clampLoopPosition(
      this.loopStartDragStartPosition + deltaQuantized
    );

    if (nextPosition !== engine.loopStart && nextPosition < engine.loopEnd) {
      engine.loopStart = nextPosition;
    }
  };

  private handleLoopEndDrag = (e: MouseEvent) => {
    const deltaX = e.clientX - this.loopEndDragStartX;

    const deltaPosition = Math.floor(deltaX / layout.sixteenthWidth);

    const deltaQuantized = quantizePosition(deltaPosition);
    const nextPosition = clampLoopPosition(
      this.loopEndDragStartPosition + deltaQuantized
    );

    if (nextPosition !== engine.loopEnd && nextPosition > engine.loopStart) {
      engine.loopEnd = nextPosition;
    }
  };

  handleLoopStartMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();

    this.loopStartDragStartX = e.clientX;
    this.loopStartDragStartPosition = engine.loopStart;

    const mouseMove = this.handleLoopStartDrag;
    const mouseUp = () => {
      document.removeEventListener('mousemove', mouseMove);
      document.removeEventListener('mouseup', mouseUp);
    };
    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('mouseup', mouseUp);
  };

  handleLoopEndMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();

    this.loopEndDragStartX = e.clientX;
    this.loopEndDragStartPosition = engine.loopEnd;

    const mouseMove = this.handleLoopEndDrag;
    const mouseUp = () => {
      document.removeEventListener('mousemove', mouseMove);
      document.removeEventListener('mouseup', mouseUp);
    };
    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('mouseup', mouseUp);
  };

  handleGridClick(scaleIndex: number, divisionIndex: number) {
    if (editor.selectedTool !== EditorTool.DRAW) {
      return;
    }

    const value = editor.getValueFromScaleIndex(scaleIndex);
    const position = divisionIndex * editor.quantizeStep;
    const duration = editor.quantizeStep;
    const note = new Note(value, position, duration);

    editor.addNote(note);
    engine.playNote(note);
  }

  @observable isMaskToolDragging = false;
  @observable isEraseToolDragging = false;

  private maskToolDragStartClientXY = [0, 0];
  @observable maskToolDragStartXY = [0, 0];
  @observable maskToolDragXY = [0, 0];

  handleMaskToolDrag = (e: MouseEvent) => {
    this.maskToolDragXY = [
      e.clientX -
        this.maskToolDragStartClientXY[0] +
        this.maskToolDragStartXY[0],
      e.clientY -
        this.maskToolDragStartClientXY[1] +
        this.maskToolDragStartXY[1],
    ];
  };

  handleGridMouseDown = (e: React.MouseEvent<SVGRectElement>) => {
    if (editor.selectedTool === EditorTool.ERASE) {
      this.isEraseToolDragging = true;
    }
    const mouseUp = () => {
      this.isEraseToolDragging = false;
      document.removeEventListener('mouseup', mouseUp);
    };
    document.addEventListener('mouseup', mouseUp);
  };

  handleMaskToolMouseDown = (e: React.MouseEvent<SVGRectElement>) => {
    e.preventDefault();
    const target = e.target as SVGRectElement;
    const dim = target.getBoundingClientRect();
    this.maskToolDragStartXY = [e.clientX - dim.left, e.clientY - dim.top];
    this.maskToolDragXY = [e.clientX - dim.left, e.clientY - dim.top];
    this.maskToolDragStartClientXY = [e.clientX, e.clientY];

    this.isMaskToolDragging = true;

    const mouseUp = () => {
      let [aX, aY] = this.maskToolDragStartXY;
      const [bX, bY] = this.maskToolDragXY;
      const startX = aX <= bX ? aX : bX;
      const startY = aY <= bY ? aY : bY;
      const endX = aX > bX ? aX : bX;
      const endY = aY > bY ? aY : bY;

      const positionRange = [
        quantizePosition(startX / layout.sixteenthWidth, Math.floor),
        quantizePosition(endX / layout.sixteenthWidth, Math.ceil),
      ];
      const valueRange = [
        MAX_PITCH - Math.floor(endY / layout.noteHeight),
        MAX_PITCH - Math.floor(startY / layout.noteHeight),
      ];

      editor.maskNotes(positionRange, valueRange);

      this.isMaskToolDragging = false;
      this.maskToolDragStartClientXY = [0, 0];
      this.maskToolDragStartXY = [0, 0];
      this.maskToolDragXY = [0, 0];
      document.removeEventListener('mousemove', this.handleMaskToolDrag);
      document.removeEventListener('mouseup', mouseUp);
    };
    document.addEventListener('mousemove', this.handleMaskToolDrag);
    document.addEventListener('mouseup', mouseUp);
  };

  private maskLaneDragStartX = 0;
  private maskLaneDragX = 0;
  private maskLaneDragStartClientX = 0;

  handleMaskLaneMouseDown = voiceIndex => (
    e: React.MouseEvent<SVGRectElement>
  ) => {
    e.preventDefault();
    const target = e.target as SVGRectElement;
    const dim = target.getBoundingClientRect();
    this.maskLaneDragStartX = e.clientX - dim.left;
    this.maskLaneDragX = e.clientX - dim.left;
    this.maskLaneDragStartClientX = e.clientX;

    this.isMaskToolDragging = true;

    const mouseMove = (e: MouseEvent) => {
      this.maskLaneDragX =
        e.clientX - this.maskLaneDragStartClientX + this.maskLaneDragStartX;
    };

    const mouseUp = () => {
      let aX = this.maskLaneDragStartX;
      const bX = this.maskLaneDragX;
      const startX = aX <= bX ? aX : bX;
      const endX = aX > bX ? aX : bX;

      const positionRange = [
        quantizePosition(startX / layout.sixteenthWidth, Math.floor),
        quantizePosition(endX / layout.sixteenthWidth, Math.ceil),
      ];

      editor.generationMasks[voiceIndex] = _.range(
        positionRange[0],
        positionRange[1]
      );

      document.removeEventListener('mousemove', mouseMove);
      document.removeEventListener('mouseup', mouseUp);
    };

    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('mouseup', mouseUp);
  };

  handleMaskLaneClick = (voiceIndex: number) => () => {
    editor.addMask(voiceIndex, _.range(0, editor.totalSixteenths));
  };

  handleMaskRectClick = (voiceIndex: number, maskIndices: number[]) => () => {
    editor.removeMask(voiceIndex, maskIndices);
  };
}

export default new Interactions();
