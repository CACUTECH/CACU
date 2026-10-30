'use server';

import { revalidatePath } from 'next/cache';
import { OpeningPositionError, OpeningPositionService, type OpeningAnswers } from '@/services/opening-position-service';

function failed(error: unknown) {
  return { success: false as const, error: error instanceof Error ? error.message : 'The change was not confirmed.',
    uncertain: error instanceof OpeningPositionError ? error.uncertain : true };
}

export async function getOpeningPositionAction() {
  try { return { success: true as const, data: await new OpeningPositionService().get() }; } catch (error) { return failed(error); }
}

export async function saveOpeningPositionAction(requestKey: string, version: number, answers: OpeningAnswers) {
  try {
    const data = await new OpeningPositionService().save(requestKey, version, answers);
    revalidatePath('/setup/books');
    return { success: true as const, data };
  } catch (error) { return failed(error); }
}

export async function approveOpeningPositionAction(version: number, note: string) {
  try {
    const data = await new OpeningPositionService().approve(version, note);
    revalidatePath('/setup/books');
    return { success: true as const, data };
  } catch (error) { return failed(error); }
}
