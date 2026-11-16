// face-api on tfjs-node, runs locally (needs node <=22)

import * as tf from '@tensorflow/tfjs-node';
import * as faceapi from '@vladmandic/face-api';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/@vladmandic/face-api/model');

// face-api.js convention: a euclidean distance between descriptors below this is "the same person"
const MATCH_THRESHOLD = 0.6;

let modelsLoaded: Promise<void> | null = null;
const ensureModelsLoaded = () => {
  if (!modelsLoaded) {
    modelsLoaded = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromDisk(MODEL_DIR),
      faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR),
      faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR),
    ]).then(() => undefined);
  };
  return modelsLoaded;
};

const descriptorFor = async (imageBytes: Buffer): Promise<Float32Array | null> => {
  const tensor = tf.node.decodeImage(imageBytes, 3) as tf.Tensor3D;
  try {
    const result = await faceapi
      .detectSingleFace(tensor, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();
    return result?.descriptor ?? null;
  } finally {
    tensor.dispose();
  };
};

// used to reject a bad reference photo on upload
export const hasFace = async (imageBytes: Buffer): Promise<boolean> => {
  await ensureModelsLoaded();
  return (await descriptorFor(imageBytes)) !== null;
};

// dark/flat frames can still false-positive a face
const MIN_MEAN_BRIGHTNESS = 15; // 0-255 scale
const MAX_MEAN_BRIGHTNESS = 245;

/** Whether the photo is usable at all - not (near) solid black or blown-out white. */
export const isUsableImage = async (imageBytes: Buffer): Promise<boolean> => {
  const tensor = tf.node.decodeImage(imageBytes, 3) as tf.Tensor3D;
  try {
    const meanTensor = tensor.mean();
    const [mean] = await meanTensor.data();
    meanTensor.dispose();
    return mean >= MIN_MEAN_BRIGHTNESS && mean <= MAX_MEAN_BRIGHTNESS;
  } finally {
    tensor.dispose();
  };
};

export type FaceMatchResult =
  | { outcome: 'matched' | 'mismatched'; distance: number }
  | { outcome: 'no_face_in_photo' | 'no_face_in_reference' };

export const compareFaces = async (photoBytes: Buffer, referenceBytes: Buffer): Promise<FaceMatchResult> => {
  await ensureModelsLoaded();
  const [photoDescriptor, referenceDescriptor] = await Promise.all([descriptorFor(photoBytes), descriptorFor(referenceBytes)]);

  if (!photoDescriptor) return { outcome: 'no_face_in_photo' };
  if (!referenceDescriptor) return { outcome: 'no_face_in_reference' };

  const distance = faceapi.euclideanDistance(photoDescriptor, referenceDescriptor);
  return { outcome: distance < MATCH_THRESHOLD ? 'matched' : 'mismatched', distance };
};
