import React from 'react';
import { VOICES } from '../core/constants';
import { VOICE_COLORS } from '../core/theme';

export class Filters extends React.Component {
  render() {
    return VOICES.map((VOICE, index) => {
      const voice = VOICE.toLowerCase();
      const color = VOICE_COLORS[index];
      return (
        <defs>
          <filter
            id={`glow-${voice}`}
            x="-5000%"
            y="-5000%"
            width="10000%"
            height="10000%"
          >
            <feFlood
              result="flood"
              flood-color={`${color}`}
              flood-opacity="1"
            />
            <feComposite
              in="flood"
              result="mask"
              in2="SourceGraphic"
              operator="in"
            />
            <feMorphology
              in="mask"
              result="dilated"
              operator="dilate"
              radius="2"
            />
            <feGaussianBlur in="dilated" result="blurred" stdDeviation="5" />
            <feMerge>
              <feMergeNode in="blurred" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      );
    });
  }
}
