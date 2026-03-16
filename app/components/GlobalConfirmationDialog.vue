<template>
  <UiAlertDialog :open="store.ui.confirmationDialog.isOpen" @update:open="onOpenChange">
    <UiAlertDialogContent>
      <UiAlertDialogHeader>
        <UiAlertDialogTitle>{{ store.ui.confirmationDialog.title }}</UiAlertDialogTitle>
        <UiAlertDialogDescription>
          {{ store.ui.confirmationDialog.description }}
        </UiAlertDialogDescription>
      </UiAlertDialogHeader>
      <UiAlertDialogFooter>
        <UiAlertDialogCancel @click="store.closeConfirmationDialog">{{ store.ui.confirmationDialog.cancelLabel }}</UiAlertDialogCancel>
        <UiAlertDialogAction @click="onConfirm" class="bg-destructive text-destructive-foreground hover:bg-destructive/90">
          {{ store.ui.confirmationDialog.confirmLabel }}
        </UiAlertDialogAction>
      </UiAlertDialogFooter>
    </UiAlertDialogContent>
  </UiAlertDialog>
</template>

<script setup lang="ts">
import { useMatrixStore } from '~/stores/matrix';

const store = useMatrixStore();

const onOpenChange = (open: boolean) => {
  if (!open) {
    store.closeConfirmationDialog();
  }
};

const onConfirm = () => {
  store.ui.confirmationDialog.onConfirm();
  store.closeConfirmationDialog();
};
</script>
