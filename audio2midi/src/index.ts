import "@spotify/basic-pitch";
import {
  addPitchBendsToNoteEvents,
  BasicPitch,
  NoteEventTime,
  noteFramesToTime,
  outputToNotesPoly,
} from "@spotify/basic-pitch";
import * as tf from "@tensorflow/tfjs";
import { Midi } from "@tonejs/midi";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";

const webAudioApi = require("web-audio-api");
const { AudioContext } = webAudioApi;
require("@tensorflow/tfjs-node");

const inputFileName = "data/input.mp3";
const resampledFileName = "data/input.resampled.wav";

// @ts-ignore
function writeDebugOutput(
  name: string,
  notes: NoteEventTime[],
  noMelodiaNotes: NoteEventTime[]
) {
  // Leaving this in because it's good when we need to update tests
  fs.writeFileSync(`${name}.json`, JSON.stringify(notes));
  fs.writeFileSync(`${name}.nomelodia.json`, JSON.stringify(noMelodiaNotes));
  const midi = new Midi();
  const trackWithMelodia = midi.addTrack();
  // trackWithMelodia.name = name;
  // notes.forEach(note => {
  //   trackWithMelodia.addNote({
  //     midi: note.pitchMidi,
  //     duration: note.durationSeconds,
  //     time: note.startTimeSeconds,
  //     velocity: note.amplitude,
  //   });
  //   if (note.pitchBends) {
  //     note.pitchBends.forEach((b, i) =>
  //       trackWithMelodia.addPitchBend({
  //         time:
  //           note.startTimeSeconds +
  //           (note.durationSeconds * i) / note.pitchBends!.length,
  //         value: b,
  //       }),
  //     );
  //   }
  // });
  const trackNoMelodia = midi.addTrack();
  trackNoMelodia.name = `${name}.nomelodia`;
  noMelodiaNotes.forEach((note) => {
    trackNoMelodia.addNote({
      midi: note.pitchMidi,
      duration: note.durationSeconds,
      time: note.startTimeSeconds,
      velocity: note.amplitude,
    });
    if (note.pitchBends) {
      note.pitchBends.forEach((b, i) =>
        trackWithMelodia.addPitchBend({
          time:
            note.startTimeSeconds +
            (note.durationSeconds * i) / note.pitchBends!.length,
          value: b,
        })
      );
    }
  });
  fs.writeFileSync(`${name}.mid`, midi.toArray());
}

const resampleAudio = (
  inputFileName: string,
  outputFileName: string,
  callback: (err: any) => void
) => {
  ffmpeg(inputFileName)
    .audioChannels(1)
    .audioFrequency(22050)
    .save(outputFileName)
    .on("end", () => {
      console.log("Resampled audio file saved as", outputFileName);
      callback(null);
    })
    .on("error", (err: any) => {
      console.error("Error resampling audio file:", err);
      callback(err);
    });
};

const main = async () => {
  const model = tf.loadGraphModel(`file://${__dirname}/model/model.json`);
  const wavBuffer = fs.readFileSync(resampledFileName);

  const audioCtx: any = new AudioContext();
  let audioBuffer;

  audioCtx.decodeAudioData(
    wavBuffer,
    async (_audioBuffer: AudioBuffer) => {
      audioBuffer = _audioBuffer;
    },
    () => {}
  );

  while (audioBuffer === undefined) {
    await new Promise((r) => setTimeout(r, 1));
  }

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  let pct: number = 0;

  const basicPitch = new BasicPitch(model);
  // testing with an AudioBuffer as input
  await basicPitch.evaluateModel(
    audioBuffer as unknown as AudioBuffer,
    (f: number[][], o: number[][], c: number[][]) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p: number) => {
      pct = p;
    }
  );

  // expect(pct).toEqual(1);

  const framesForArray: number[][] = [];
  const onsetsForArray: number[][] = [];
  const contoursForArray: number[][] = [];
  pct = 0;

  // testing if get the same result with a Float32Array as input
  await basicPitch.evaluateModel(
    (audioBuffer as AudioBuffer).getChannelData(0),
    (f: number[][], o: number[][], c: number[][]) => {
      framesForArray.push(...f);
      onsetsForArray.push(...o);
      contoursForArray.push(...c);
    },
    (p: number) => {
      pct = p;
    }
  );

  // expect(pct).toEqual(1);
  // expect(framesForArray).toEqual(frames);
  // expect(onsetsForArray).toEqual(onsets);
  // expect(contoursForArray).toEqual(contours);

  const poly = noteFramesToTime(
    addPitchBendsToNoteEvents(
      contours,
      outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)
    )
  );

  const polyNoMelodia = noteFramesToTime(
    addPitchBendsToNoteEvents(
      contours,
      outputToNotesPoly(frames, onsets, 0.5, 0.3, 5, true, null, null, false)
    )
  );
  writeDebugOutput("data/output", poly, polyNoMelodia); // use if we update the note creation
  // const polyNotes: NoteEventTime[] = require('../test_data/poly.json');
  // const polyNoMelodiaNotes: NoteEventTime[] = require('../test_data/poly.nomelodia.json');

  // expect(poly).toBeCloseToMidi(polyNotes, 1e-3, 0);
  // expect(polyNoMelodia).toBeCloseToMidi(polyNoMelodiaNotes, 1e-3, 0);
};

resampleAudio(inputFileName, resampledFileName, (err) => {
  if (err) {
    console.error(err);
    return;
  }
  main();
});
