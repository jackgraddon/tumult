<template>
  <UiAlertDialog :open="uiStore.confirmationDialog.isOpen" @update:open="onOpenChange">
    <UiAlertDialogContent>
      <UiAlertDialogHeader>
        <UiAlertDialogTitle>{{ uiStore.confirmationDialog.title }}</UiAlertDialogTitle>
        <UiAlertDialogDescription>
          {{ uiStore.confirmationDialog.description }}
        </UiAlertDialogDescription>
      </UiAlertDialogHeader>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel @click="uiStore.closeConfirmationDialog">{{ uiStore.confirmationDialog.cancelLabel }}</UiAlertDialogCancel>
        <UiAlertDialogAction class="bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="onConfirm">
          {{ uiStore.confirmationDialog.confirmLabel }}
        </UiAlertDialogAction>
      </UiAlertDialogFooter>
    </UiAlertDialogContent>
  </UiAlertDialog>
</template>

<script setup lang="ts">
import { useMatrixStore } from '~/stores/matrix';

const store = useMatrixStore();
const uiStore = useUIStore();
const matrixService = useMatrixService();
const presenceStore = usePresenceStore();

const onOpenChange = (open: boolean) => {
  if (!open) {
    uiStore.closeConfirmationDialog();
  }
};

const onConfirm = () => {
  uiStore.confirmationDialog.onConfirm();
  uiStore.closeConfirmationDialog();
};
</script>
